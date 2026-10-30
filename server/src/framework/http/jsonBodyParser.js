import express, {Router} from "express";

export function normalizeJsonBodyLimit(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2097152) {
    throw new TypeError("jsonBodyLimitBytes must be a positive integer at most2097152");
  }
  return value;
}

export function createJsonBodyParser({routes,defaultLimit}) {
  const selectedLimit=Symbol("registeredJsonBodyLimit"),classifier=Router(),parsers=new Map();
  const parser=limit=>{
    if(!parsers.has(limit))parsers.set(limit,express.json({limit,verify:(req,_res,buffer)=>{req.rawBody=buffer;}}));
    return parsers.get(limit);
  };
  parser(defaultLimit);
  for(const route of routes){
    const limit=Object.hasOwn(route,"jsonBodyLimitBytes")?normalizeJsonBodyLimit(route.jsonBodyLimitBytes):defaultLimit;
    parser(limit);
    classifier[String(route.method).toLowerCase()](route.path,(req,_res,next)=>{req[selectedLimit]=limit;next("router");});
  }
  return (req,res,next)=>{
    // OPTIONS is not a registered API method; Express's implicit reply belongs to the real dispatcher.
    if(req.method==="OPTIONS"){parser(defaultLimit)(req,res,next);return;}
    // The existing receive watchdog observes data. Hold flow across Router's asynchronous exit
    // until the selected parser has installed its readers; skipped multipart stays paused for its owner.
    req.pause();
    const prior=new Map(["params","route","baseUrl"].map(key=>[key,Object.getOwnPropertyDescriptor(req,key)]));
    classifier(req,res,error=>{
      const limit=error?defaultLimit:req[selectedLimit]??defaultLimit;
      delete req[selectedLimit];
      for(const [key,descriptor]of prior){if(descriptor)Object.defineProperty(req,key,descriptor);else delete req[key];}
      // The real dispatcher still owns malformed parameter URI errors after the default parser.
      if(error&&!(error instanceof URIError&&error.status===400)){next(error);return;}
      let waiting=true;
      parser(limit)(req,res,error=>{waiting=false;next(error);});
      if(waiting)req.resume();
    });
  };
}

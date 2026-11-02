import {constants} from 'node:fs';
import {open} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {getSalesObservationBaseline} from '../src/modules/sales/salesOperationalBaseline.js';
import {SalesOperationalObservationService} from '../src/modules/sales/SalesOperationalObservationService.js';
const uuid=value=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(value);
const invalid=()=>{throw new Error('Explicit Sales observation activation arguments/attestation required');};
export function parseSalesObservationActivationArguments(argv){
 if(argv.length===1&&argv[0]==='--print-baseline')return {printBaseline:true};
 const options={};if(argv.length!==4)invalid();for(let i=0;i<argv.length;i+=2){const key=argv[i];if(!['--attestation','--expected-epoch'].includes(key)||Object.hasOwn(options,key))invalid();options[key]=argv[i+1];}
 if(typeof options['--attestation']!=='string'||!path.isAbsolute(options['--attestation'])||!(options['--expected-epoch']==='none'||uuid(options['--expected-epoch'])))invalid();
 return {attestationPath:options['--attestation'],expectedEpoch:options['--expected-epoch']==='none'?null:options['--expected-epoch']};
}
export async function readSalesObservationAttestation(file){
 const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);try{
  const info=await handle.stat();if(!info.isFile()||typeof process.getuid!=='function'||info.uid!==process.getuid()||(info.mode&0o077)!==0||info.nlink!==1||info.size<1||info.size>8192)invalid();
  const bytes=Buffer.alloc(8193),{bytesRead}=await handle.read(bytes,0,bytes.length,0);if(bytesRead>8192)invalid();const value=JSON.parse(bytes.subarray(0,bytesRead).toString('utf8'));
  if(!value||Object.keys(value).sort().join(',')!=='allWorkersInstrumented,baselineHash,oldWorkersDrained,protocolVersion'||value.protocolVersion!=='1'||typeof value.baselineHash!=='string'||!/^[a-f0-9]{64}$/u.test(value.baselineHash)||value.allWorkersInstrumented!==true||value.oldWorkersDrained!==true)invalid();return value;
 }finally{await handle.close();}
}
// Operator-only CLI: no HTTP endpoint, Scheduler start, implicit activation, migration, grant or coverage backdating.
export async function runSalesObservationActivation(argv=process.argv.slice(2)){
 const options=parseSalesObservationActivationArguments(argv),attestation=options.printBaseline?null:await readSalesObservationAttestation(options.attestationPath);
 const {default:dotenv}=await import('dotenv');dotenv.config({path:fileURLToPath(new URL('../.env',import.meta.url))});
 const {defaultConfigurationSource,validateApplicationConfiguration}=await import('../src/framework/configuration/applicationConfiguration.js');
 const config=validateApplicationConfiguration(defaultConfigurationSource()),baselineHash=getSalesObservationBaseline(config);if(options.printBaseline)return {protocolVersion:'1',baselineHash};
 if(attestation.baselineHash!==baselineHash)invalid();
 const [{createMySqlDatabasePool},{MySqlDatabaseService},{RequestContextService},{SystemTimeService}]=await Promise.all([
  import('../src/services/mysqldatabase/connection.js'),
  import('../src/services/mysqldatabase/MySqlDatabaseService.js'),
  import('../src/services/context/RequestContextService.js'),
  import('../src/services/time/SystemTimeService.js')]);
 const time=new SystemTimeService({config}),context=new RequestContextService({services:{require:()=>time}}),pool=createMySqlDatabasePool(config.database),database=new MySqlDatabaseService({pool,config:config.database,context,logger:{error:async()=>{}}}),controller=new AbortController(),abort=()=>controller.abort(new Error('Sales observation activation interrupted'));
 process.once('SIGINT',abort);process.once('SIGTERM',abort);
 try{return await context.storage.run({signal:controller.signal},()=>new SalesOperationalObservationService({database,baselineHash,authorizeActivation:value=>value===attestation}).activate({expectedEpoch:options.expectedEpoch,attestation,signal:controller.signal}));}
 finally{process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);await pool.end();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runSalesObservationActivation().then(value=>console.log(JSON.stringify(value))).catch(error=>{console.error(error?.code==='DATABASE_TRANSACTION_INDETERMINATE'?'Sales observation activation outcome unknown; inspect persisted COVERAGE before any retry':'Sales observation activation failed');process.exitCode=1;});

import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,writeFile,chmod,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {parseSalesObservationActivationArguments,readSalesObservationAttestation} from '../../../scripts/activateSalesObservations.js';
const epoch='d6a0ca0e-96a0-4ba4-bf25-343344315f66',attestation={protocolVersion:'1',baselineHash:'a'.repeat(64),allWorkersInstrumented:true,oldWorkersDrained:true};
test('OBS-A01 operator command requires explicit CAS epoch and trusted artifact attestation; never implicitly activates',()=>{
 assert.deepEqual(parseSalesObservationActivationArguments(['--print-baseline']),{printBaseline:true});assert.deepEqual(parseSalesObservationActivationArguments(['--attestation','/private/tmp/attest.json','--expected-epoch','none']),{attestationPath:'/private/tmp/attest.json',expectedEpoch:null});assert.equal(parseSalesObservationActivationArguments(['--expected-epoch',epoch,'--attestation','/private/tmp/a']).expectedEpoch,epoch);
 for(const args of [[],['--attestation','a'],['--attestation','relative','--expected-epoch','none'],['--attestation','/a','--expected-epoch','auto'],['--print-baseline','--expected-epoch','none'],['--attestation','/a','--attestation','/b','--expected-epoch','none']])assert.throws(()=>parseSalesObservationActivationArguments(args));
});
test('OBS-A01 bounded owned private regular-file attestation rejects symlinks, shared permissions and invented/missing claims',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'sales-observation-attestation-')),file=path.join(root,'attestation.json'),link=path.join(root,'link');try{
 await writeFile(file,JSON.stringify(attestation),{mode:0o600});assert.deepEqual(await readSalesObservationAttestation(file),attestation);await symlink(file,link);await assert.rejects(()=>readSalesObservationAttestation(link));await chmod(file,0o644);await assert.rejects(()=>readSalesObservationAttestation(file));await chmod(file,0o600);
 for(const value of [{...attestation,allWorkersInstrumented:false},{...attestation,oldWorkersDrained:false},{...attestation,extra:true},{...attestation,baselineHash:'arbitrary'},{}]){await writeFile(file,JSON.stringify(value));await assert.rejects(()=>readSalesObservationAttestation(file));}
 await writeFile(file,' '.repeat(8193));await assert.rejects(()=>readSalesObservationAttestation(file));
 }finally{await rm(root,{recursive:true,force:true});}
});

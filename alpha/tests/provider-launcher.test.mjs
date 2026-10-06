import test from 'node:test';
import assert from 'node:assert/strict';
import {providerTestEnv} from '../provider-regression.mjs';
test('provider launcher removes startup proxy state and credentials from child only',()=>{
 const source={PATH:'/bin',HTTP_PROXY:'http://fixture.invalid',https_proxy:'http://fixture.invalid',NO_PROXY:'example',NODE_USE_ENV_PROXY:'1',
   ALPHA_SMOKE_API_KEY:'do-not-copy',NODE_OPTIONS:'--use-env-proxy --max-old-space-size=4096'};
 const child=providerTestEnv(source);
 assert.deepEqual(child,{PATH:'/bin',NODE_OPTIONS:'--max-old-space-size=4096'});
 assert.equal(source.NODE_USE_ENV_PROXY,'1');assert.equal(source.ALPHA_SMOKE_API_KEY,'do-not-copy');
});
test('provider launcher does not disable TLS or replace configured CA files',()=>{
 const source={NODE_EXTRA_CA_CERTS:'/approved/ca.pem',SSL_CERT_FILE:'/approved/roots.pem'};
 assert.deepEqual(providerTestEnv(source),source);
});

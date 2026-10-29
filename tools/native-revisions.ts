/** Checked against signed public 0.1.71 builds; never infer support from a name alone. */
const linuxSymbols: Record<string,string> = {
  PP:'W1',cIt:'bIt',Dp:'ep',Ugs:'o_s',ERe:'zAe','$G':'a3',Fma:'Oma',hre:'yre',BFr:'aLr',
  oyt:'myt',Yat:'slt',qR:'UA',d9:'g2',Ahe:'Rme',pJc:'sed',kb:'Sb',Qxs:'wvs',
  dir:'xir',Oqn:'V3n',pu:'pu',AP:'P1',uR:'pA',Q_s:'mys',
  Y6:'XK',g3t:'k$t',Vrr:'sor',
};

export function nativeRevision(sha256:string) {
  if (sha256 === 'e3674e221f9079520f014eb2ef93d0ba151934a47fd561594efcb23a86809e0b') {
    return {platform:'darwin-arm64',useIntentDefault:'qht',symbols:{} as Record<string,string>,factory:'von',timeout:'uye',fetch:'Son',classifier:'Ji',classifierFetch:'nct',brandConstants:['kr','CJe','C0e'],archiveSha256:'b47f7886d8a0fa29022a765b53d3222e25b81ce16214ec9ffe684e5aaad8f217'};
  }
  if (sha256 === '9fd2e4e942385471ce1000b0f63873c57e2dfd5c768dbcb7b0c917fa227673c7') {
    return {platform:'linux-x64',useIntentDefault:'Qmt',symbols:linuxSymbols,factory:'jon',timeout:'pye',fetch:'qon',classifier:'ta',classifierFetch:'hct',brandConstants:['kr','DJe','R0e'],archiveSha256:'0632b5d9849e895050883c30b5f64c246ed82656432a88d7878c94ab6560d8dd'};
  }
  throw new Error('Unsupported native runtime revision. Use a verified version 0.1.71 platform build.');
}

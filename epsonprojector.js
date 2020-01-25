const constants=require("./constants");
const ESCVPnetDevice=require("./escvpnet");

class EpsonProjector extends ESCVPnetDevice {
  constructor(...args) {
    super(...args);
  }

  popmem(slot) {
    return this.set("POPMEM",["02",slot.toString(16).padStart(2,'0')]);
  }
  
  poplens(slot) {
    return this.set("POPLP",["02",slot.toString(16).padStart(2,'0')]);
  }

  
  // Since the projector doesn't save which memory slot was loaded, we
  // can infer it from a "signature" composed of a broad array of
  // settings (lens or picture).  Return a (resolved promise to) a
  // buffer of bytes, which can be used with Buffer.compare() to test
  // for equality. Note if all command queries fail, this buffer will
  // be empty (so test for that!). 
  async imageSignature() {
    var queries=[];
    
    var gamma=await(this.query("GAMMA")); 
    queries.push(Promise.resolve(parseInt(gamma,16))); // already resolved
    if (gamma=="F0") // custom Gamma Levels
      for (let i=0;i<=8;i++)  
	queries.push(this.query("GAMMALV",i.toString(16).padStart(2,'0')).then(parseInt));

    for (const k of constants.COLUINTKEYS) {
      if (k=="SHARP") {		// Sharp takes a parameter
	for (let i=0;i<2;i++)
	  queries.push(this.query(k,"0"+i.toString(16)).then(parseInt));
      } else queries.push(this.query(k).then(parseInt));
    }
    for (const k of constants.COLHEXUINTKEYS)
      queries.push(this.query(k).then(val => parseInt(val,16)));

    try {
      let params=await Promise.all(queries);
      return Buffer.from(params.filter(v => !isNaN(v)));
    } catch {
      throw new Error("Error creating Color Memory Signature");
    }
  }

  async lensSignature() {
    var queries=[];
    for (const k of constants.LENSUINT16KEYS)
      queries.push(this.query(k).then(val => parseInt(val)));
    try {
      let params=await Promise.all(queries);
      return Buffer.from(new Uint16Array(params.filter(v => !isNaN(v))).buffer);
    } catch {
      throw new Error("Error creating Lens Memory Signature");
    }
  }

  signature(type) {
    return type=="lens"?lensSignature():imageSignature();
  }
  
}

module.exports=EpsonProjector;

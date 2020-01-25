const storage = require('node-persist');
const EpsonProjector=require('./epsonprojector');
const constants=require("./constants");
let Accessory, Characteristic, Service, HAPServer;

class ProjectorAccessory {
  constructor(api, log, config) {
    Characteristic = api.hap.Characteristic;
    Service = api.hap.Service;
    HAPServer = api.hap.HAPServer;

    this.api=api;
    this.log = log;
    this.on=false;
    this.hdr=false;
    
    if(!config.ip) {
      this.log.error('no ip configured for connection, aborting.');
      return;
    }
    this.config = config;
    if (this.config.hdr && this.config.hdrQuery) {
      try {
	let hdrQuery=require(`./hdrmods/${this.hdrQuery}`);
	this.hdrmon=new hdrQuery(this.config.hdr,log);
      } catch (err) {
	this.log.error(`Could not load HDR Query Module ${this.hdrQuery}, disabling`);
	this.hdrmon=null;
      }
    }

    this.cacheDirectory = config.cacheDirectory || 
      this.cacheDirectory=`${this.api.user.persistPath()}/${constants.platformName}/device-${this.projector.macAddress}`;
    this.services = this.createServices(); 
    await storage.init({dir:this.cacheDirectory})
    await storage.getItem('signatures');


    
    this.projector=new EpsonProjector(config.ip,log);
    this.projector.on('initialized',this.init);
    this.projector.on('pwstatus',status => {
      let on = status == constants.PWSTATUS.normal;
      if (on) {
	if (!this.on) {		// turning on!
	  this.monitor();
	}
      } else {
	this.monitor(false); 	// stop monitoring
      }
      this.updatePower(this.on);
    });
    this.projector.on('error', type => {
      if (type=='connection') {
	if (this.switches.master) 
	  this.switches.master.getCharacteristic(Characteristic.on).
	  updateValue(new Error(HAPServer.Status.SERVICE_COMMUNICATION_FAILURE));
      }
    });
  }

  async init() {
    await this.updatePower();
    if (this.on) this.monitor();
  }

  // ---- SERVICES ----
  createServices() {
    var services=this.getSwitchServices();
    services.push(this.getAccessoryInformationService());
    return services;
  }

  getAccessoryInformationService() {
    return new Service.AccessoryInformation()
      .setCharacteristic(Characteristic.Name, this.projector.name)
      .setCharacteristic(Characteristic.Manufacturer, 'JD Smith')
      .setCharacteristic(Characteristic.Model, this.config.model || "Epson Projector")
      .setCharacteristic(Characteristic.SerialNumber, '01')
      .setCharacteristic(Characteristic.FirmwareRevision, this.config.version)
      .setCharacteristic(Characteristic.HardwareRevision, this.config.version);
  }

  getSwitchServices() {
    let switches=[];
    this.switches={};
    
    // Expose a master Power switch
    let sw=Service.Switch(this.projector.name);
    this.switches.master.status=false;
    this.switches.master.service=sw;
    sw.getCharacteristic(Characteristic.On)
      .on('set', this.setPower.bind(this));
    switches.push(sw);
    
    // And an HDR switch
    let sw=Service.Switch("HDR");
    this.switches.hdr.status=false;
    this.switches.hdr.service=sw;
    sw.getCharacteristic(Characteristic.On).on('set',this.setHDR.bind(this));
    switches.push(sw);
    
    // Expose image and lens setting switches in "banks"
    this.switches.memory={};
    for (type of ["image","lens"]) {
      let entry=this.config.memory[type];
      if (!entry) continue;
      let bank=this.switches.memory[type]={};
      let entries = Object.values(entry).every(v => typeof(v) == "string")?
	  [[null,entry]]:Object.entries(entry);
	
      for (const [subtype,mems] of entries) {
	let sbank=subtype?bank:bank[subtype]={};
	for (const [slot,name] of Object.entries(mems)) {
	  let sw=Service.Switch(name + '-' + subtype.toUpperCase());
	  sbank[slot].service=sw;
	  sbank[slot].status=false; // off
	  sw.getCharacteristic(Characteristic.On)//.on('get', this.getMemStatus.bind(this,type,subtype,slot))
      	    .on('set', this.setMemStatus.bind(this,type,subtype,slot));
	  switches.push(sw);
	}
      }
    }
    
    return switches;
  }

  // --- UPDATING/SETTING
  static updateOnChar(entity,status=true) {
    entity.service.getCharacteristic(Characteristic.On).updateValue(status);
    entity.status=status;
  }

  async updatePower(power) {
    if (power==undefined)
      power = await this.projector.power() == constants.PWRQUERY.lampon;
    this.on = power;
    this.switches.master.service.getCharacteristic(Characteristic.On).updateValue(this.on);
  }
  
  async setPower(value,callback) { // from HK
    this.on=value?true:false;
    this.projector.setPower(this.on);
    callback();
  }

  async updateHDR(hdr) {
    if (this.hdrmon == null) return;
    if (hdr==undefined) {
      try {
	hdr = await Promise.resolve(this.hdrmon.ishdr());
      } catch (err) {
	this.log.error(`Unable to query HDR status: $err`)
	return;
      }
    } 
    if (hdr==null) {
      this.log.warning("HDR status unavailable");
      return
    }
    
    if (hdr != this.hdr) {
      this.hdr = hdr;
      this.switches.hdr.service.getCharacteristic(Characteristic.On).updateValue(this.hdr);
      this.switches.hdr.status=this.hdr;
      this.setImageMemSlotforHDR();
    }
  }
  
  setHDR(value,callback) {	// from HK only
    this.switches.hdr.status=value;
    callback();
    if (this.hdr != this.switches.hdr.status) {
      this.hdr = this.switches.hdr.status;
      this.setImageMemSlotforHDR();
    }
  }
    
  // update a memory bank by toggling one on exclusively. 
  updateMemBank(type,subtype,slot,onlyOthers=false) {
    let bank=this.switches.memory[type];
    if (subtype) bank=bank[subtype];
    for (const [s,n] of Object.entries(bank)) {
      if (s!=slot) {	// turn others off!
	ProjectorAccessory.updateOnChar(bank[s],false);
      }
    }
    if (!onlyOthers) 		// update new slot too
      ProjectorAccessory.updateOnChar(bank[slot],true);
  }

  // Don't need if we only use UPDATE!
  // getMemStatus(type,subtype,slot,callback) {
  //   try {
  //     let bank=this.switches.memory[type];
  //     if (subtype) bank=bank[subtype];
  //     callback(null,bank[slot].status);
  //   } catch (err) {
  //     callback(new Error(err));
  //   }
  // }

  // setMemStatus: Respond to switches being set in HomeKit, by
  // setting the status of the memory switch at position
  // type/subtype/slot and maybe directing the projector to switch to
  // that memory setting.  Should ONLY BE CALLED FROM HOMEKIT.  See
  // updateMemBank to reflect local changes inferred from the
  // projector in the switch services.
  async setMemStatus(type,subtype,slot,status,callback) {
    try {
      let bank=this.switches.memory[type];
      if (subtype) bank=bank[subtype];
      bank[slot].status=status;
      if (status) {		// explicity turned on?
	this.updateMemBank(type,subtype,slot,true);
	if (this.setMemSlot(type,subtype,slot,true))
	  await this.recordMemSignature(type,slot); // changed on projector: record it!
      }
      callback();
    } catch (err) {
      this.log.error(`Error setting ${type}/${subtype} slot ${slot} status to ${status}: ${err}`);
      callback(new Error(err));
    }
  }
  
  // --- SIGNATURES (lens, image)
  writeSignatures() {
    storage.setItem('signatures',this.signatures);
  }

  async updateWithSignature(type) {
    let slot=await this.getMatchingSignatureSlot(type);
    if (slot) { 
      let bank=this.switches[type];
      if (type=="image") {
	for (subtype of Object.keys(bank)) {
	  if (Object.keys(bank[subtype]).find(slot)) {
	    this.updateMemBank(type,subtype,slot);
	    break;
	  }
	}
      } else if (Object.keys(bank).find(slot)) {
	this.updateMemBank(type,subtype,slot);
      }
    }
  }
    
  // Read the current Memory Bank signatures, and update the switches,
  // if a match is identified.
  updateWithSignatures() {
    return ["image","lens"].map(type => this.updateWithSignature(type));
  }


  async matchingSignatures(type) {
    let cursig=await this.projector.signature(type);
    return Object.entries(this.signatures[type]).
      sort((a, b) => a[0]-b[0]).
      filter(([_,sig]) => Buffer.compare(cursig,sig)==0);
  }

  async recordMemSignature(type,slot) {
    let matchingSigs=await this.matchingSignatures(type);
    if (matchingSigs.length > 0) {
      let others=matchingSigs.filter(([s,]) => s!=slot).map(e=>e[0]);
      if (others.length>0)
	this.log.warning(`Setting ${type} slot ${slot}: existing slot${matchingSigs.length>1?"s":""}` +
			 `already match${matchingSigs.length>1?"":"es"} current signature:`,
			 others.join(","));
    }
    this.signatures[type][slot]=cursig;
    this.writeSignatures();	
  }
    
  async getMatchingSignatureSlot(type) {
    let matchingSigs=await this.matchingSignatures(type);
    if (matchingSigs.length == 0) {
      this.log.warning(`No matching ${type} signature found, try toggling in Homekit`);
      return null;
    }
    if (matchingSigs.length > 1)
      this.log.warning(`Multiple matching ${type} signatures found, using first`);
    return matchingSigs[0][0];
  }

  // Load the memory SLOT for TYPE(/SUBTYPE), but (for "image" TYPE, if
  // ENFORCE is true) only if SUBTYPE matches current HDR status.
  // Return true if set.
  setMemSlot(type,subtype,slot,enforce=false) {
    if (type=="image" && (!enforce || subtype==this.hdr?"hdr":"sdr")) {
      this.projector.popmem(slot);
      return true;
    }
    if (type == "lens") {
      this.projector.poplens(slot);
      return true;
    } 
    return false;
  }

  // Monitor for changes in HDR status and Memory Bank settings (via signatures)
  async monitor(command) {
    if (command==undefined || command) {
      try {
	await Promise.all([this.updateHDR(),...this.updateWithSignatures()]);
	this.timer=setTimeout(o=>o.monitor(),1e3*(this.config.monitorInterval || 10),this);
      } catch (err) {
	this.log.error(`Monitoring error: ${err}`);
	return;
      }
    } else {
      clearTimeout(this.timer);
      this.timer=null;
    }
  }

  // Set the "active" image memory slot in the projector given the
  // current HDR status
  setImageMemSlotforHDR() {
    let bank=this.switches.memory[type][this.hdr?"hdr":"sdr"];
    let sortedSlots=Object.keys(bank).sort((a,b) a - b); // keys are always strings
    let firstOn=sortedSlots.find(s => bank[s].status);
    if (firstOn == undefined) {		// no switch flipped
      firstOn=sortedSlot[0];		// just take the first one
      ProjectorAccessory.updateOnChar(bank[firstOn]); // flip it on!
    }
    return this.projector.popmem(firstOn); // set it!
  }
}

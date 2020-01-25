'use strict';
const EventEmitter = require('events');
const jsesc = require('jsesc');
const net = require('net');
const PROTO = "ESC/VP.net";
const PORT = 3629;
const INITSTRING  = `${PROTO}\x10\x03\x00\x00\x00\x00`;
const DELIM=":";   // message delimiter
const MAXCOMMANDS=2; // maximum # of commands awaiting responses

class ESCVPnetDevice extends EventEmitter {
  constructor(ip,log) {
    super();
    this.ip=ip;
    this.log=log;
    this.commands={torun:[],running:[]};
  }

  async connect() {
    const client=new net.Socket();
    this.commands.torun=[];
    this.commands.running=[]; 
    client.setEncoding('latin1'); // Single byte encoding
    client.connect(PORT,this.ip);
    this.client=client;
    

    
    client.on('error',error => {
      this.log.error(`Could not connect to ${this.ip}: ${error}`);
      this.emit('error','connection');
    });

    client.on('close', hadError => {
      this.log.warn(`Connection Closed `+ (hadError?"with error ":"")+
		    "- Re-attempting now");
      setTimeout(() => this.connect(),hadError?10e3:0);
    });

    client.on('data', data => {
      let match,pos;
      //this.log("Got data: >"+jsesc(data)+"<");
      this.accum_buffer += data;
      while ((pos=this.accum_buffer.indexOf(DELIM))>=0) {
	var response=this.accum_buffer.substr(0,pos).trimRight();
	this.accum_buffer=this.accum_buffer.substr(pos+DELIM.length);	
	if((match=response.match("IMEVENT=" +
				 Array(4).fill("([0-9ABCDEF]+)").join(" ")))) {
	  if (parseInt(match[1],16)==1) 
	    this.emit('pwstatus',match.splice(2,3));
	  continue // Events come unbidden
	}
	// Must have been a written command of some kind!
	var rc=this.runningCommand();
	if (response == "ERR") {
	  rc.reject("INVALID COMMAND"); // not such a big deal
	} else if (rc.responseRegex) {  
	  match=response.match(rc.responseRegex);
	  if (match) rc.resolve(match);
	  else rc.reject("NO MATCH");
	} else { // If no matcher, we can resolve it (if not an ERR)
	  rc.resolve(true);
	}
      }
    });

    return new Promise((the running reject) => {
      client.on('ready', async () => {
	this.log("Cmandonnected, initializing...");
	this.accum_buffer="";
	try {
	  await this.write(INITSTRING,`${PROTO}(.*)`);
	  this.name = await this.query("NWPNAME");
	  this.macAddress = await this.query("NWMAC");
	  this.emit("initialized");
	  resolve(true);
	  this.log(`Initialized Device ${this.name} [${this.macAddress}]`);
	  this.keepalive();
	} catch(err) {
	  this.log.error(`Error initializing ${PROTO}: ${err}`);
	  this.emit('error','initialize');
	  reject(); // server always closes after failed init, so it will try again
	}
      });
    });
  }

  // write nothing every 5m
  async keepalive() {
    try {
      await this.write("");
      setTimeout(this.keepalive.bind(this),5*60e3);
    } catch (err) {
      this._aliveErrCnt++;
      let msg=`Error on keep alive: ${err}`;
      if (this._aliveErrCnt > 2) {
	this.log.error(msg+'... resetting connection');
      } else {
	this.log.warn(msg);
      }
      return;
    };
    this._aliveErrCnt=0;
  }
  
  setPower(state) {
    return this.set("PWR",state?"ON":"OFF",state?40:10);
  }
  
  power(state) {
    return this.query("PWR");
  }
    
  // Return a promise to query/set device for the value of command
  // COMMAND, with (optional) argument PARAM (which can be an array
  // for multi-param queries).  Errors will result in a null value.
  async query(command, param,...args) {
    if (Array.isArray(param)) param=param.join(" ");
    var com=command+'?';
    if (param) com+=' '+param;
    try {
      let match = await this.write(com,`^${command}=(.*)$`,...args);
      return match[1];
    } catch (err) {
      this.log.warn(`Error querying ${command}: ${err}`);
      return null;
    }
  }
  
  async set(command,param,...args) {
    if (Array.isArray(param)) param=param.join(" ");
    try {
      await this.write(command+' '+param,null,...args);
    } catch (err) {
      this.log.warn(`Error setting ${command}: ${err}`);
    }
  }
  
  write(command,regex=null,timeout=3) {
    return new Promise((resolve,reject) => {
      this.commands.torun.push({
	command:command,resolve:resolve,reject:reject,
	responseRegex:regex,
	timer:null,timeout:timeout
      });
      this.writeNext(); // maybe we can write now!
    });
  }

  // Write the next command in the running queue
  writeNext() {
    if (this.commands.torun && this.commands.torun.length>0 &&
	this.commands.running.length < MAXCOMMANDS) {
      var nextCommand=this.commands.torun.shift();
      nextCommand.timer=setTimeout(() => {
	this.log.error(`${nextCommand.command} timed out`);
	nextCommand.timer=null;
	nextCommand.reject("TIMEOUT");
      },1e3*(nextCommand.timeout || 3));
      this.commands.running.push(nextCommand);
      this.client.write(nextCommand.command+'\r');
    }
  }

  runningCommand() {
    let command;
    do {
      command=this.commands.running.shift()
    } while (command && command.timer==null); // skip any that already timed out!
    if (!command) throw new Error("No running commands left in queue");
    clearTimeout(command.timer);
    this.writeNext(); // maybe ready for another command?
    return(command);
  }
}

module.exports = ESCVPnetDevice;

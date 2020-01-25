// Module to ask Denon-like receivers for the HDR status of their
// video input. Returns false (no HDR), true (HDR), or null
// (unknown/no signal)
const axios = require('axios');
const XMLREQ=`<?xml version="1.0" encoding="utf-8" ?>
<tx>
 <cmd id="3"><name>GetVideoInfo</name>
 <list><param name="hdmisigin"></param></list>
 </cmd>
</tx>`;
const CONFIG = {headers: {'Content-Type': 'text/xml'}};

class DenonHDRQuery {
  constructor(config,log) {
    this.log=log;
    this.url=`http://${config.ip}:8080/goform/AppCommand0300.xml`;
    console.log(this.url);
  }

  async ishdr() {
    try{
      let xml = await axios.post(this.url,XMLREQ,CONFIG);
      let match=xml.data.match(/<param +name="hdmisigin"[^>]+>([^<]+)</);
      if (!match) throw new Error("No HDR value found");
      if (match[1].trim() == "---") return null;
      return match[1].indexOf("HDR")>=0;
    } catch (err) {
      this.log.error(`Error determining HDR status from receiver: ${err}`);
      return null;
    }
  }	   
}

module.exports=DenonHDRQuery;

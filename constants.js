module.exports = {
  COLUINTKEYS:["LUMINANCE","BRIGHT","CONTRAST","DENSITY","TINT","SHARP","CTEMP","FCOLOR",
	       "OFFSETR","OFFSETG","OFFSETB","GAINR","GAING","GAINB","SHRF",
	       "SHRS","DERANGE","DESTRENGTH"], // 0-255 uint values
  COLHEXUINTKEYS:["CMODE","MCFI","4KENHANCE","IMGPRESET","DYNRANGE"], //  hex values
  LENSUINT16KEYS: ["ZOOM","FOCUS","LENS","HLENS"],
  DEFAULT_CACHE_DIRECTORY : "./.node-persist/storage",
  platformName: 'homebridge-epson-vpnet',
  platformPrettyName: 'EpsonESC/VP.net',
  PWSTATUS: {standby:'01',warmup:'02',normal:'03',cooldown:'04',abnormal:'FF'},
  PWRQUERY: {standbyoff:'00',lampon:'01',warmup:'02',cooldown: '03',standby: '04',abnormal: '05'}
}

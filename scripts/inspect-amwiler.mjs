const base='https://services3.arcgis.com/RfpmnkSAQleRbndX/ArcGIS/rest/services/Property_and_Tax/FeatureServer';
for(const path of ['/3/query?'+new URLSearchParams({f:'json',where:"STRNUM=3000 AND UPPER(STRNAME) LIKE '%AMWILER%'",outFields:'*',returnGeometry:'false'})]) {
 const d=await fetch(base+path).then(r=>r.json());console.log(JSON.stringify({path,data:d}));
}

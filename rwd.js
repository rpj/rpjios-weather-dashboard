let qs = {};

const loginExpiry = 24; // hours
const windowSize = 150;

const BT_V = 1;
const BT_L = 0;

const plotConfig = {
  displayModeBar: false, 
  scrollZoom: false, 
  responsive: true
};

const isLocal = location.hostname === 'localhost' || 
  location.hostname.startsWith('192.168.') ||
  location.hostname.startsWith('10.0.') ||
  location.hostname === 'newcharlie' ||
  location.hostname.endsWith('ryjo.be');

const hostStubProto = isLocal ? `://${window.location.host}:56545` : `s://api.${window.location.host}`;

const _ = {
  id: document.getElementById.bind(document),
  new: document.createElement.bind(document),
  r: (v, f = 100, c = 4) => Number((Math.round(v * f) / f).toPrecision(c)).toFixed(0),
  dc: (eId) => {
    let deepClone = _.id(eId).cloneNode(true);
    deepClone.removeAttribute('id');
    return deepClone;
  }
};

const getAuth = () => window.localStorage.getItem('auth');

async function getList(channel, sensor, cadence = 600, backMins = 240) {
    let opts = {
      headers: { 'Authorization': `Basic ${getAuth()}` }
    };

    let otp;
    try {
        otp = await fetch(`http${hostStubProto}/list/${channel}:${sensor}:.list?back=${backMins}&cad=${cadence}`, opts);
    } catch (err) {
        console.log(err);
    }

    if (!otp || otp.status !== 200) {
      console.log(`getList(${channel}, ${sensor}, ${backMins}, ${cadence}) failed:`);
      console.log(otp);
      return [];
    }

    return otp.json();
}

async function subscribe(channel, onMessage, onClose, backoff = 0) {
    let opts = {
      headers: { 'Authorization': `Basic ${getAuth()}` }
    };

    let otp;
    try {
        otp = await fetch(`http${hostStubProto}/sub/${channel}`, opts);
    } catch (err) {
        console.log(err);
    }

    const reconnWithBackoff = () => {
        let waitMs = backoff++ ** 2;
        console.log(`trying to reconnect ${(new Date()).toISOString()}... (waiting ${waitMs}ms)`);
        setTimeout(subscribe.bind(null, channel, onMessage, onClose, backoff), waitMs); 
    };

    if (!otp || otp.status !== 200) {
      console.log('sub req failed');
      console.log(otp);
      reconnWithBackoff();
      return;
    }

    backoff = 0;
    let ws = new WebSocket(`ws${hostStubProto}/ws/sub?${(await otp.text())}`);
    ws.addEventListener('message', (ev) => onMessage(JSON.parse(JSON.parse(ev.data))));
    ws.addEventListener('close', (ev) => {
        onClose();
        reconnWithBackoff();
    });
}

function newSubscribeElement(channel, parentId, onMessage, onClose) {
  let intoEle = _.dc('gridtmpl');
  intoEle.id = `nSE_grid_${channel}`;
  _.id(parentId).append(intoEle);

  if (!onClose) {
    onClose = () => {
      console.log(`channel ${channel} closed, removing associated element...`);
       _.id(parentId).removeChild(intoEle);
     }; 
  }
  
  subscribe(channel, (jpData) => onMessage(intoEle, jpData), onClose);

  return intoEle;
}

function newLayout(titleText) {
    return {
        title: { 
            text: titleText,
            font: {
                family: '"Lucida Console", Monaco, monospace',
                color: '#eeefff'
            }
        },
        datarevision: 0,
        margin: { l: 40, r: 5, b: 1, t: 5, pad: 0 },
        plot_bgcolor: '#444555',
        paper_bgcolor: '#111222',
        colorway: ['#eeefff', '#aaccff'],
        xaxis: { 
            ticks: "",
            showticklabels: false
        },
        yaxis: { 
            tickcolor: '#eeefff',
            tickfont: { 
                family: '"Lucida Console", Monaco, monospace',
                color: '#eeefff'
            } 
        },
        legend: {
            xanchor: 'center',
            yanchor: 'middle',
            font: {
                family: '"Lucida Console", Monaco, monospace',
                size: 9,
                color: '#eeefff'
            },
            ypad: 0,
            xpad: 0,
            x: 0.5,
            y: -0.15,
            bgcolor: '#222333',
            orientation: 'h'
        },
    };
} 

function addSPS30() {
  let pm25ele = _.dc('basictmpl');
  let pm10ele = _.dc('basictmpl');
  pm25ele.id = 'pm25ele';

  let firstTs;
  let pm25PlotDiv = _.new('div');
  pm25PlotDiv.id = 'pm25Plot';
  pm25PlotDiv.className = 'plot';

  let pm25PlotData = {
    x: [],
    y: [],
    type: 'scatter',
    name: 'PM 2.5'
  };

  let pm25PlotLayout = newLayout();
  let pm25PlotDataSpec = [pm25PlotData];
  
  pm25ele.children.item(BT_L).innerHTML = 'PM 2.5';

  let spsEle = newSubscribeElement('zed:sensor:SPS30', 'div_one', (ele, jpData) => {
    const r25 = _.r(jpData.value.mc_2p5, 100, 3);

    pm25ele.children.item(BT_V).innerHTML = r25;

    if (firstTs === undefined) {
      firstTs = jpData.ts;
    }
    
    if (pm25PlotData.x.length === windowSize) {
      pm25PlotData.x.shift();
      pm25PlotData.y.shift();
    }

    pm25PlotData.x.push(jpData.ts - firstTs);
    pm25PlotData.y.push(r25);
    pm25PlotLayout.datarevision += 1;

    if (Math.max(...pm25PlotData.y) - Math.min(...pm25PlotData.y) > 100) {
      pm25PlotLayout.yaxis.type = 'log';
    } else if ('yaxis' in pm25PlotLayout) {
      pm25PlotLayout.yaxis.type = 'linear';
    }

    Plotly.react('pm25Plot', pm25PlotDataSpec, pm25PlotLayout, plotConfig); 
  }, () => {
    pm25ele.children.item(BT_V).innerHTML = '---';
  });

  spsEle.append(pm25ele);
  spsEle.append(pm25PlotDiv);
  Plotly.newPlot('pm25Plot', pm25PlotDataSpec, pm25PlotLayout, plotConfig);
  spsEle.append(_.new('div'));
}

const timestrconv = (timeArr) => {
  let val = Math.round((timeArr[timeArr.length-1] - timeArr[0]) / 60);
  let txt = val > 1 ? 'minutes' : 'minute';

  if (val > 60) {
    val = Math.round(val / 60);
    txt = val > 1 ? 'hours' : 'hour';
  }

  return `(the last ${val} ${txt})`;
}
    
async function addBME280() {
  let tempEle = _.dc('basictmpl'); 
  let humdEle = _.dc('basictmpl');
  let presEle = _.dc('basictmpl');
  let timeEle = _.dc('basictmpl');
  timeEle.className += ' time';

  let presPlot = _.new('div');
  let ppTimeStr = _.new('div');
  ppTimeStr.className = 'timestr';
  presPlot.id = 'presPlot';
  presPlot.className = 'plot';

  let plotCadence = 600;
  let plotBackMins = 2160; // max allowed
  let plotBackMult = 2;

  if ('pb' in qs) {
    plotBackMins = Math.max(Math.min(Number.parseInt(qs.pb), plotBackMins), 1);
  }

  if ('pc' in qs) {
    plotCadence = Math.max(Math.min(Number.parseInt(qs.pc), (plotBackMins / 2) * 60), 10)
  }

  if ('pbm' in qs) {
    plotBackMult = Math.max(Math.min(Number.parseInt(qs.pbm), 5), 1);
  }

  console.log(`plotBackMins=${plotBackMins} plotCadence=${plotCadence} plotBackMult=${plotBackMult}`);

  let presPlotData = { x: [], y: [], type: 'scatter', name: undefined };
  let presPlotLayout = newLayout();
  let presPlotDataSpec = [presPlotData];
  presList = await getList('zero:sensor:BME280', 'pressure', plotCadence, plotBackMins);
  let presPlotFirstTime;
  presList.reverse().forEach((presVal) => {
    if (presPlotFirstTime === undefined) {
      presPlotFirstTime = presVal[0];
    }
    presPlotData.x.push(presVal[0]);
    presPlotData.y.push(presVal[1]);
  });
  presPlotLayout.datarevision = 1;
  let lastPresPostTS = presList[0][0];

  let thPlot = _.new('div');
  let thTimeStr = _.new('div');
  thTimeStr.className = 'timestr thtimestr';
  thPlot.id = 'thPlot';
  thPlot.className = 'plot';

  let tPlotData = { x: [], y: [], type: 'scatter', name: 'Outdoor Temperature (F)' };
  let hPlotData = { x: [], y: [], type: 'scatter', name: 'Rel. Humidity (%)' };
  let thPlotLayout = newLayout();
  let thPlotDataSpec = [tPlotData, hPlotData];
  tList = await getList('zero:sensor:BME280', 'temperature', plotCadence, plotBackMins);
  hList = await getList('zero:sensor:BME280', 'humidity', plotCadence, plotBackMins);
  let tFirstTime, hFirstTime;
  tList.reverse().forEach((val) => {
    if (tFirstTime === undefined) {
      tFirstTime = val[0];
    }
    tPlotData.x.push(val[0]);
    tPlotData.y.push(val[1]);
  });
  hList.reverse().forEach((val) => {
    if (hFirstTime === undefined) {
      hFirstTime = val[0];
    }
    hPlotData.x.push(val[0]);
    hPlotData.y.push(val[1]);
  });
  thPlotLayout.datarevision = 1;
  let lastThPostTS = tList[0][0];

  tempEle.children.item(BT_L).innerHTML = 'Outdoor Temperature<br/>';
  humdEle.children.item(BT_L).innerHTML = 'Relative Humidity<br/>';
  presEle.children.item(BT_L).innerHTML = 'Barometric Pressure<br/>';
  timeEle.children.item(BT_L).innerHTML = '';

  let thpEle = newSubscribeElement('zero:sensor:BME280', 'div_one', (ele, jpData) => {
    tempEle.children.item(BT_V).innerHTML = `${_.r(jpData.value.temperature, 10, 3)}&deg;F`;
    humdEle.children.item(BT_V).innerHTML = `${_.r(jpData.value.humidity, 10, 3)}%`;
    presEle.children.item(BT_V).innerHTML = _.r(jpData.value.pressure, 10, 5);
    
    if (jpData.ts - lastPresPostTS > plotCadence) { 
      if (jpData.ts - presPlotFirstTime > (plotBackMins * plotBackMult * 60)) {
        presPlotData.x.shift();
        presPlotData.y.shift();
        presPlotFirstTime = presPlotData.x[0];
      }
      presPlotData.x.push(jpData.ts);
      presPlotData.y.push(jpData.value.pressure);
      console.log(`P (${lastPresPostTS}) presPlot.push([${jpData.ts}, ${jpData.value.pressure}])`);
      presPlotLayout.datarevision += 1;
      Plotly.react('presPlot', presPlotDataSpec, presPlotLayout, plotConfig);
      lastPresPostTS = jpData.ts;
      ppTimeStr.innerHTML = timestrconv(presPlotData.x);
    }
    
    if (jpData.ts - lastThPostTS > plotCadence) { 
      if (jpData.ts - tFirstTime > (plotBackMins * plotBackMult * 60)) {
        tPlotData.x.shift();
        tPlotData.y.shift();
        tFirstTime = tPlotData.x[0];
      }
      if (jpData.ts - hFirstTime > (plotBackMins * plotBackMult * 60)) {
        hPlotData.x.shift();
        hPlotData.y.shift();
        hFirstTime = hPlotData.x[0];
      }
      tPlotData.x.push(jpData.ts);
      hPlotData.x.push(jpData.ts);
      tPlotData.y.push(jpData.value.temperature);
      hPlotData.y.push(jpData.value.humidity);
      console.log(`TH (${lastThPostTS}) ${JSON.stringify(jpData)}`);
      thPlotLayout.datarevision += 1;
      Plotly.react('thPlot', thPlotDataSpec, thPlotLayout, plotConfig);
      lastThPostTS = jpData.ts;
      thTimeStr.innerHTML = timestrconv(tPlotData.x);
    }
   
    timeEle.children.item(BT_V).innerHTML = new Date(jpData.ts * 1e3).toLocaleTimeString().replace('PM', '').replace('AM', '');
  }, () => {
    tempEle.children.item(BT_V).innerHTML = '--.-&deg;F';
    humdEle.children.item(BT_V).innerHTML = '--.-%';
    presEle.children.item(BT_V).innerHTML = '----';
    timeEle.children.item(BT_V).innerHTML = '--:--:--';
  });

  thpEle.append(tempEle);
  thpEle.append(humdEle);
  humdEle.append(thTimeStr);
  humdEle.append(thPlot);
  presEle.append(ppTimeStr);
  presEle.append(presPlot);
  thpEle.append(presEle);
  thpEle.append(timeEle);
  Plotly.newPlot('presPlot', presPlotDataSpec, presPlotLayout, plotConfig);
  Plotly.newPlot('thPlot', thPlotDataSpec, thPlotLayout, plotConfig);
  return timeEle;
}

async function loadPage() {
  let kvCookies = window.localStorage;
  let authBox = _.id('authbox');

  if (!('auth' in kvCookies)) {
    _.id("div_one").append(authBox);
    authBox.style.display = "block";
  } else {
    authBox.parentElement.removeChild(authBox);
    let finalEle = await addBME280();
    if ('pm' in qs || 'aqi' in qs || 'sps' in qs) {
      addSPS30();
    }
  }
}

async function auth() {
  let lExp = new Date(Date.now() + (loginExpiry * 3600 * 1e3)).toGMTString()
  let authEnc = window.btoa(`${_.id("in_u").value}:${_.id("in_p").value}`);
  window.localStorage.setItem('auth', authEnc);
  location.search = '';
  loadPage();
}

window.onload = async () => {
  if (location.search) {
    qs = location.search.replace('?', '').split('&').map(x => x.split('=')).reduce((a, x) => { 
      a[x[0]] = x[1];
      return a;
    }, {});
  }

  if ('logout' in qs) {
    window.localStorage.clear();
  }
 
  _.id('authbut').addEventListener('click', () => auth());
  loadPage();
};

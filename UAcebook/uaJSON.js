String.prototype.repeat = function(num) {
  return new Array(num + 1).join(this);
}

// Simulates PHP's date function
Date.prototype.format=function(format){var returnStr='';var replace=Date.replaceChars;for(var i=0;i<format.length;i++){var curChar=format.charAt(i);if(i-1>=0&&format.charAt(i-1)=="\\"){returnStr+=curChar;}else if(replace[curChar]){returnStr+=replace[curChar].call(this);}else if(curChar!="\\"){returnStr+=curChar;}}return returnStr;};Date.replaceChars={shortMonths:['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],longMonths:['January','February','March','April','May','June','July','August','September','October','November','December'],shortDays:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],longDays:['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'],d:function(){return(this.getDate()<10?'0':'')+this.getDate();},D:function(){return Date.replaceChars.shortDays[this.getDay()];},j:function(){return this.getDate();},l:function(){return Date.replaceChars.longDays[this.getDay()];},N:function(){return this.getDay()+1;},S:function(){return(this.getDate()%10==1&&this.getDate()!=11?'st':(this.getDate()%10==2&&this.getDate()!=12?'nd':(this.getDate()%10==3&&this.getDate()!=13?'rd':'th')));},w:function(){return this.getDay();},z:function(){var d=new Date(this.getFullYear(),0,1);return Math.ceil((this-d)/86400000);},W:function(){var d=new Date(this.getFullYear(),0,1);return Math.ceil((((this-d)/86400000)+d.getDay()+1)/7);},F:function(){return Date.replaceChars.longMonths[this.getMonth()];},m:function(){return(this.getMonth()<9?'0':'')+(this.getMonth()+1);},M:function(){return Date.replaceChars.shortMonths[this.getMonth()];},n:function(){return this.getMonth()+1;},t:function(){var d=new Date();return new Date(d.getFullYear(),d.getMonth(),0).getDate()},L:function(){var year=this.getFullYear();return(year%400==0||(year%100!=0&&year%4==0));},o:function(){var d=new Date(this.valueOf());d.setDate(d.getDate()-((this.getDay()+6)%7)+3);return d.getFullYear();},Y:function(){return this.getFullYear();},y:function(){return(''+this.getFullYear()).substr(2);},a:function(){return this.getHours()<12?'am':'pm';},A:function(){return this.getHours()<12?'AM':'PM';},B:function(){return Math.floor((((this.getUTCHours()+1)%24)+this.getUTCMinutes()/60+this.getUTCSeconds()/3600)*1000/24);},g:function(){return this.getHours()%12||12;},G:function(){return this.getHours();},h:function(){return((this.getHours()%12||12)<10?'0':'')+(this.getHours()%12||12);},H:function(){return(this.getHours()<10?'0':'')+this.getHours();},i:function(){return(this.getMinutes()<10?'0':'')+this.getMinutes();},s:function(){return(this.getSeconds()<10?'0':'')+this.getSeconds();},u:function(){var m=this.getMilliseconds();return(m<10?'00':(m<100?'0':''))+m;},e:function(){return"Not Yet Supported";},I:function(){return"Not Yet Supported";},O:function(){return(-this.getTimezoneOffset()<0?'-':'+')+(Math.abs(this.getTimezoneOffset()/60)<10?'0':'')+(Math.abs(this.getTimezoneOffset()/60))+'00';},P:function(){return(-this.getTimezoneOffset()<0?'-':'+')+(Math.abs(this.getTimezoneOffset()/60)<10?'0':'')+(Math.abs(this.getTimezoneOffset()/60))+':00';},T:function(){var m=this.getMonth();this.setMonth(0);var result=this.toTimeString().replace(/^.+ \(?([^\)]+)\)?$/,'$1');this.setMonth(m);return result;},Z:function(){return-this.getTimezoneOffset()*60;},c:function(){return this.format("Y-m-d\\TH:i:sP");},r:function(){return this.toString();},U:function(){return this.getTime()/1000;}};

HashMap = function() {
  this._dict = [];
}
HashMap.prototype._get = function(key) {
  for(var i=0, couplet; couplet = this._dict[i]; i++) {
    if(couplet[0] === key) {
      return couplet;
    }
  }
}
HashMap.prototype.put = function(key, value) {
  var couplet = this._get(key);
  if(couplet) {
    couplet[1] = value;
  } else {
    this._dict.push([key, value]);
  }
  return this; // for chaining
}
HashMap.prototype.get = function(key){
  var couplet = this._get(key);
  if(couplet) {
    return couplet[1];
  }
}

var debug = false;
var client = "<default>";

function myAlert(text, title) {
  if(title != null) {
	alert(title + "\n-----\n\n" + text);
  } else {
    alert(text);
  }
}

function myJSONAlert(text, json, title) {
  myAlert(text + ":\n" + JSON.stringify(json, null, 2), title);
}

function getHtmlText(text) {
  text = text.replace(/&/g, "&amp;");

  text = text.replace(/</g, "&lt;");
  text = text.replace(/>/g, "&gt;");

  text = text.replace(/\r/g, "");
  text = text.replace(/\n/g, " <br>\n");

  text = text.replace(/(ftp|http|https|file):\/\/[\S]+(\b|$)/gim,'<a href="$&" target="_blank">$&</a>');
  text = text.replace(/([^\/])(www[\S]+(\b|$))/gim,'$1<a href="http://$2" class="my_link" target="_blank">$2</a>');

  return text;
}


function sendGetRequest(url, successFunction) {
  // Set cursor to hourglass
  document.body.style.cursor = "wait";

  try {
  url = getUrl(url);

  if(debug) {
    myAlert("Sending " + url, "sendGetRequest");
  }
  $.ajax({
    beforeSend: function(req) {
      req.setRequestHeader("User-Agent", client);
    },
    url: url,
    success: function(data, status, req) {
	  // Turn hourglass off
	  document.body.style.cursor = "default";
	  
      if(debug) {
        myJSONAlert("Response: " + status, data, "sendGetRequest");
      }
      if(data != null) {
        try {
          successFunction(data);
        } catch(e) {
          myAlert("Exception " + e.message, "sendGetRequest");
        }
      } else {
        myAlert("No data", "sendGetRequest");
      }
    },
    error: function(header, status, error) {
	  // Turn hourglass off
	  document.body.style.cursor = "default";

	  myAlert("Error requesting " + url +"\nStatus: " + status + "\nError: " + error, "sendGetRequest");
    }
  });
  } catch(e) {
    // Turn hourglass off
    document.body.style.cursor = "default";
    
	myAlert("Exception " + e.message, "sendGetRequest");
  }
}

function sendPostRequest(url, json, successFunction) {
  // Set cursor to hourglass
  document.body.style.cursor = "wait";

  try {
  url = getUrl(url);

  if(debug) {
    myJSONAlert("Sending " + url, json, "sendPostRequest");
  }
  $.ajax({
    beforeSend: function(req) {
      req.setRequestHeader("User-Agent", client);
    },
    url: url,
    // we always send JSON, we should mark it as such
    contentType: "application/json",
    type: "POST",
    data: JSON.stringify(json),
    success: function(data, status, req) {
	  // Turn hourglass off
	  document.body.style.cursor = "default";
	  
      if(debug) {
        myJSONAlert("Response: " + status, data, "sendPostRequest");
      }
      if(data != null) {
        try {
          successFunction(data);
        } catch(e) {
          myAlert("Exception " + e.message, "sendPostRequest");
        }
      } else {
        myAlert("No data", "sendPostRequest");
      }
    },
    error: function(header, status, error) {
	  // Turn hourglass off
	  document.body.style.cursor = "default";
	  
      myAlert("Error requesting " + url +"\nStatus: " + status + "\nError: " + error, "sendPostRequest");
    }
  });
  } catch(e) {
    // Turn hourglass off
    document.body.style.cursor = "default";
    
    myAlert("Exception " + e.message, "sendPostRequest");
  }
}

client = "UAcebook v0.5";

//myAlert("Setting stuff up", "UAcebook.js");
var currentFolderFilter = "Unread";
var currentFolderName = null;
var currentMessageFilter = null;
var currentMessage = null;
var currentMessageElement = null;
var currentUser = null;

function createLink(id, style, url, text) {
  var href = "\"#\" onclick=\"" + url + ";return false\"";
  if(id != null) {
    id = " id=\"" + id + "\"";
  } else {
    id = "";
  }
  if(style != null) {
    style = " class=\"" + style + "\"";
  } else {
    style = "";
  }
  var link = "<a " + id + " " + style + " href=" + href + ">" + text + "</a>";
  //myAlert("Link: " + link, "createLink");
  return link;
}

function getFieldStr(name, value) {
  return "<br>\n" + name + ": <b>" + value + "</b>";
}

var foldersTimer = 0;

function showBanner() {
  sendGetRequest("/system", function(response) {
    $("#folder").html("<pre>\n" + response.banner + "\n</pre>");
  });
}

function showFolders(filter) {
  if(filter == null) {
	  filter = currentFolderFilter;
  }
  
  //alert("Showing unread folders");
  sendGetRequest("/folders/" + filter.toLowerCase(), function(response) {
    $("#show" + currentFolderFilter + "Folders").removeClass("selected");
    currentFolderFilter = filter;
    $("#show" + currentFolderFilter + "Folders").addClass("selected");
    
    console.log(typeof response);
    response.sort(function(a, b) {
      return a.folder == b.folder ? 0 : (a.folder > b.folder ? 1 : -1 );
    });

    var totalUnread = 0;
    var div = "";
    $.each(response, function(i, item) {
      var text = "<span id=\"folder-" + item.folder + "\">";
      text += item.folder;
      if(item.unread > 0) {
    	text += " (" + item.unread + " of " + item.count + ")"
      } else if(item.count > 0) {
      	text += " (" + item.count + ")"
      }
      text += "</span>";
      if(div.length > 0) {
    	div += "<br>\n";
      }
      //div += createLink("folder-" + item.folder, null, "showFolder('" + item.folder + "')", text);
      div += createLink(null, null, "showFolder('" + item.folder + "', null)", text);

      if(item.subscribed) {
        totalUnread += item.unread;
      }
    });
    $("#foldersList").html(div);
    
    $("#folder-" + currentFolderName).addClass("currentFolder");

    $("#totalUnread").html(totalUnread);

    var d = new Date();
    $("#lastRefresh").html(d.format('H:i'));
  });

  if(foldersTimer != 0) {
	clearTimeout(foldersTimer);
  }
  foldersTimer = setTimeout("showFolders(null)", 120000);
}

function showFolder(name, filter) {
  sendGetRequest("/folder/" + name, function(response) {
	$("#folder-" + currentFolderName).removeClass("currentFolder");
    currentFolderName = name;
	$("#folder-" + currentFolderName).addClass("currentFolder");

    $("#show" + currentMessageFilter + "Messages").removeClass("selected");
    if(filter != null) {
      currentMessageFilter = filter;
    } else {
      // Default is smart filtering (show unread unless there are none in which case show them all)
      filter = "All";
      $.each(response, function(i, item) {
        if(!item.read) {
          //myAlert("Triggering unread filter because " + item.id + " is unread", "showFolder");
          filter = "Unread";
          return false;
        }
      });
      if(currentMessageFilter == null) {
    	  currentMessageFilter = filter;
      }
    }
    $("#show" + filter + "Messages").addClass("selected");
    
    var div = "";

    var indents = new HashMap();
    var first = true;
    $.each(response, function(i, item) {
      var indent = 0;
      if(typeof(item.inReplyTo) != "undefined") {
        indent = indents.get(item.inReplyTo);
        indent++;
      }
      indents.put(item.id, indent);

      if(filter == "All" || !item.read) {
        //myJSONAlert("Message", item, "showFolder");
        var d = new Date(1000 * item.epoch);

        var indentStr = "&nbsp;";
        indentStr = indentStr.repeat(indent);

        var text = "";

        if(typeof(item.subject) != "undefined") {
          text += getHtmlText(item.subject);
        }
        text += " (" + item.id + " on " + d.format('D j/m');
        text += " from " + item.from + ")";

        if(first) {
          first = false;
        } else {
          div += "<br>";
        }

        div += indentStr + createLink("message-" + item.id, item.read ? "read" : "unread", "showMessage('" + item.id + "')", text) + "\n";
        div += "\n";
      }
    });

    //myAlert("Div content:\n" + div, "showFolder");
    
    $("#folder").html(div);

    $("#folderName").html(" in " + currentFolderName);

    var element = document.getElementById("folder");
    if(element != null) {
      element.scrollTop = 0;
    }
  });
  
  if(document.getElementById("currentMessageElement") != null) {
    $(currentMessageElement).addClass("currentMessage");
    setMessageMode(true, false);
  } else {
	  setMessageMode(false, false);
  }
}

function setMessageFilter(filter) {
  if(currentFolderName != null) {
    showFolder(currentFolderName, filter);
  }
}

function showMessage(id) {
  sendGetRequest("/message/" + id, function(response) {
    if(response.folder != currentFolderName) {
      showFolder(response.folder);
    }

    // Reset current indicator i.e. styles on links in the folder list
    
    $(currentMessageElement).removeClass("unread currentMessage");
    
    currentMessage = response;
    setMessageMode(true, false);
    
    currentMessageElement = "#message-" + id;
    $(currentMessageElement).removeClass("unread");
    $(currentMessageElement).addClass("read currentMessage");

    var d = new Date(1000 * response.epoch);

    var div = "\n<b>" + response.id + "</b> in <b>" + response.folder + "</b>, " + d.format('H:i:s l jS F Y');
    div += getFieldStr("From", response.from);
    if(typeof(response.to) != "undefined") {
      div += getFieldStr("To", response.to);
    }
    if(typeof(response.subject) != "undefined") {
      div += getFieldStr("Subject", getHtmlText(response.subject));
    }
    if(typeof(response.inReplyToHierarchy) != "undefined") {
      var replyStr = "";
      $.each(response.inReplyToHierarchy, function(i, item) {
    	replyStr += " " + createLink(null, "messagelink", "showMessage('" + item.id + "')", item.id);
      });
      div += getFieldStr("In-Reply-To", replyStr);
    }
    if(typeof(response.replyToBy) != "undefined") {
      var replyStr = "";
      $.each(response.replyToBy, function(i, item) {
    	replyStr += " " + createLink(null, "messagelink", "showMessage('" + item.id + "')", item.id);
      });
      div += getFieldStr("Replied-To-In", replyStr);
    }
    div += "\n";
    $("#messageheaders").html(div);

    if(typeof(response.body) != "undefined") {
      $("#messagebody").html("\n" + getHtmlText(response.body) + "\n");
    }

    if(typeof(response.annotations) != "undefined") {
      var annotationsStr = "";
      $.each(response.annotations, function(i, item) {
    	annotationsStr += getFieldStr("Edited by", item.from) + ", " + item.body; 
      });
      $("#messagefooters").html(annotationsStr);
      $("#messagefooters").show();
    } else {
      $("#messagefooters").hide();
    }
    
    var request = new Array();
    request[0] = parseInt(id);
    sendPostRequest("/message/read", request, function(response) {
    });
  });
}

function postMessage(folder, to, subject, inReplyTo, body, successFunction) {
  if(debug) {
    myAlert("Posting in " + folder + " to " + to + " about " + subject + " in reply to " + inReplyTo + " saying " + body, "postMessage");
  }

  var command = "folder";

  var request = new Object();

  if(folder != null && folder != "") {
    command += "/" + folder;
  }
  if(to != null && to != "") {
	  request.to = to;
  }
  request.subject = subject;
  if(inReplyTo != null && inReplyTo != "") {
    command = "message/" + inReplyTo;
  }
  request.body = body;

  return sendPostRequest("/" + command, request, function(response) {
	if(debug) {
      myJSONAlert("Message reply", response, "postMessage");
	} else {
	  myAlert("Posted message in " + response.folder, "postMessage");
	}
	
	if(successFunction != null) {
      try {
	    successFunction(response);
      } catch(e) {
        myAlert("Exception calling success function " + e.message, "postMessage");
      } 
	}
  });
}

function showUsername() {
  if(currentUser == null) {
    sendGetRequest("/user", function(response) {
      currentUser = response;
      //myJSONAlert("Current user retrieved", currentUser, "showUsername");
      $("#username").html(currentUser.name);
    });
  }
}

function setMessageMode(view, post) {
  if(view) {
    $("#viewMessage").show();
  } else {
    $("#viewMessage").hide();
  }
  
  if(post) {
    $("#postMessage").show();
  } else {
    $("#postMessage").hide();
  }
}

function enablePostMode(message) {
  if(message != null) {
	if(debug) {
	  myJSONAlert("Message", message, "enablePostMode");
	}
	  
    $("#postReplyId").val(message.id);
    
	$("#postFolder").val(message.folder);
	$("#postTo").val(message.from);
	$("#postSubject").val(message.subject);
	$("#postBody").val(message.body + "\r\n\r\n");
  } else {
	if(currentFolderName != null) {
	  $("#postReplyId").val("");
	  
      $("#postFolder").val(currentFolderName);
      $("#postTo").val("");
	  $("#postSubject").val("");
      $("#postBody").val("");
	}
  }

  setMessageMode(false, true);
}

function disablePostMode() {
  setMessageMode(true, false);
}

var sys = require('util');
var util = require('util');

// bloody tree structure idiot nonsense
function flatten_folder_list(edf, child, depth) {
    var json = [];
    for(i in edf) {
        if (edf[i].tag == 'folder') {
            var x = edf[i];
            child.flatten(x);
            json.push({"folder": x.name, "unread": x.unread||0,
                       "count": x.nummsgs, "subscribed": x.subscribed?true:false,
                       "id": x.value
            });
            if (x.children) {
                for(var i in x.children) {
                    var d = flatten_folder_list(x.children[i], child, depth+1);
                    json = json.concat(d);
                }
            }
        };
    };
    return json;
}

function flatten_message_list(edf, child, depth, folder) {
    var json = [];
    var children = [];

    for(i in edf) {
        if (edf[i].tag == 'message') {
            var x = edf[i];
            var retval = {
                "folder": folder, "epoch": x.date,
                "id": x.value, "subject": x.subject,
                "body": x.text, "from": x.fromname,
                "replyToBy": x.replyToBy,
                "inReplyToHierarchy": x.inReplyToHierarchy
            };

            if (x.inReplyToHierarchy !== undefined) {
                retval.inReplyTo = x.inReplyToHierarchy[0].id;
            }

            // the 'read' key must be present for various broken clients
            retval['read'] = (x.read !== undefined);
            if (x.toname !== undefined) { retval['to'] = x.toname; }

            json[x.value] = retval;
        };
    };
    var list = [];
    for (var i in json) {
        list.push(json[i]);
    }
    list.sort(function(a,b){return a.id - b.id});
    return list;
}

function uajson() {
};

uajson.prototype.reply_folder_list = function(edfjson, child) {
    var x = child.recursive_flatten(edfjson, 0);
    var json = flatten_folder_list(x, child, 0);
    return json;
};

uajson.prototype.reply_message_list = function(edfjson, child) {
    // experimental
	var y = JSON.parse(JSON.stringify(edfjson));
	child.flatten(y);
    var folder = y.foldername;
    var x = child.recursive_flatten(edfjson, 0, folder);
    var json = flatten_message_list(x, child, 0, folder);
    return json;
};

exports.uajson = uajson;

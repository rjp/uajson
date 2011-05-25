var sys = require('sys');
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
    for(i in edf) {
        if (edf[i].tag == 'message') {
            var x = edf[i];
            var retval = {
                "folder": folder, "epoch": x.date,
                "id": x.value, "subject": x.subject,
                "body": x.text, "from": x.fromname
            };

            if (x.read !== undefined) { retval['read'] = true; }

            // broken
            var parents = [];
            for (var j in edf[i].children) {
                var c = edf[i].children[j];
                if (c.tag == 'replyto') {
                    child.flatten(c);
                    parents.push({"id":c.value, "from":c.fromname});
                    retval['inReplyTo'] = c.value;
                }
            }
            if (parents.length > 0) { retval['inReplyToHierarchy'] = replies; }

            var replies = [];
            for (var j in edf[i].children) {
                var c = edf[i].children[j];
                if (c.tag == 'replyby') {
                    child.flatten(c);
                    replies.push({"id":c.value, "from":c.fromname});
                }
            }
            if (replies.length > 0) { retval['replyToBy'] = replies; }
            if (x.toname !== undefined) { retval['to'] = x.toname; }

            json.push(retval);
        };
    };
    return json;
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
        var x = child.recursive_flatten(edfjson, 0);
		var y = JSON.parse(JSON.stringify(edfjson));
		child.flatten(y);
        var folder = y.foldername;
        var json = flatten_message_list(x, child, 0, folder);
        return json;
    };
exports.uajson = uajson;

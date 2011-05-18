var sys = require('sys');

function uajson() {
};

    uajson.prototype.reply_folder_list = function(edfjson, child) {
        child.flatten(edfjson);
        var json = [] ;
        for(i in edfjson.children) {
        sys.puts(JSON.stringify(edfjson.children[i]));
            if (edfjson.children[i].tag == 'folder') {
                var x = edfjson.children[i];
                child.flatten(x);
                json.push({
                    "folder": x.name, "unread": x.unread||0,
                    "count": x.nummsgs, "subscribed": x.subscribed
                });
            };
        };
        return json;
    };

    uajson.prototype.reply_message_list = function(edfjson, child) {
        child.flatten(edfjson);
        var json = [] ;
        var folder = edfjson.foldername;
        for(i in edfjson.children) {
            if (edfjson.children[i].tag == 'message') {
                var x = edfjson.children[i];
                child.flatten(x);
                sys.puts(sys.inspect(x));
                var retval = {
                    "folder": folder, "epoch": x.date,
                    "id": x.value, "subject": x.subject,
                    "body": x.text, "from": x.fromname,
                    "read": x.read ? true : false
                };

                var parents = [];
                for (var j in edfjson.children[i].children) {
                    var c = edfjson.children[i].children[j];
                    if (c.tag == 'replyto') {
                        child.flatten(c);
                        sys.puts(sys.inspect(c));
                        parents.push({"id":c.value, "from":c.fromname});
                        retval['inReplyTo'] = c.value;
                    }
                }
                if (parents.length > 0) {
                    retval['inReplyToHierarchy'] = replies;
                }

                var replies = [];
                for (var j in edfjson.children[i].children) {
                    var c = edfjson.children[i].children[j];
                    if (c.tag == 'replyby') {
                        child.flatten(c);
                        sys.puts(sys.inspect(c));
                        replies.push({"id":c.value, "from":c.fromname});
                    }
                }
                if (replies.length > 0) {
                    retval['replyToBy'] = replies;
                }


                if (x.toname !== undefined) {
                    retval['to'] = x.toname;
                }
                json.push(retval);
            };
        };
        return json;
    };
exports.uajson = uajson;

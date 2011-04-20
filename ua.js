function uajson() {
};

    uajson.prototype.reply_folder_list = function(edfjson, child) {
        child.flatten(edfjson);
        var json = [] ;
        for(i in edfjson.children) {
            if (edfjson.children[i].tag == 'folder') {
                var x = edfjson.children[i];
                json.push({
                    "folder": x.name, "unread": x.unread||0,
                    "count": x.nummsgs, "subscribed": x.subscribed
                });
            };
        };
        return json;
    };
exports.uajson = uajson;

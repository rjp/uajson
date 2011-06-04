var sys = require('sys');
var uaclient = require('./node-uaclient/lib/uaclient');
var connect = require('./connect/lib/connect/index'),
    staticFiles = require('./connect/lib/connect/middleware/staticProvider');
var fs = require('fs');
var Log = require('log'), log = new Log(Log.INFO);
// functions for converting EDF responses to JSON
var uajson = require('./ua.js');
var uajson = new uajson.uajson;

var g_req;
var g_res;
var g_folders = {};
var g_bodies = {};

var SESSION_TIMEOUT = 900 * 1000;

// use a hashed mix for the session key to avoid hijacking
var crypto = require('crypto');
function session_key(ingredients) {
    var unhashed_key = ingredients.join('!');
    return crypto.createHash('md5').update(unhashed_key).digest("hex");
}

// how do we block without blocking?
function folder_info(foldername, callback) {
    callback({folder_id: g_folders[foldername]});
}

function cache_folders(ting, success) {
//   log.warning(sys.inspect(thash));
    log.warning("cache_folders");
    success();
}

function announce_message_add(child, ting) {
    child.flatten(ting);
    sys.puts("AMA for "+child.username);
}

var config_json = fs.readFileSync(process.argv[2], 'utf8');
var config = JSON.parse(config_json);

var server = connect.createServer(
    connect.logger({ format: ':method :url' }),
    connect.bodyDecoder(),
    connect.errorHandler({ dumpExceptions: true, showStack: true })
);
server.use(connect.basicAuth(authenticate, 'uajson:'+config.port));
server.use('/', connect.router(app));

server.listen(config.port);
log.info('Connect server listening on port '+config.port);

// holds information about our child bots
var ua_sessions = {};

function authenticate(user, pass, success, failure) {
    // log.info('authinfo is '+user+':'+pass+"; "+failure);
    spawn_bot(user, pass, 'http_auth', success, failure);
}

function buffer_to_strings(x) {
    for(var i in x) {
        if (typeof x === "buffer") {
            x[i] = x[i].toString('utf8');
        }
    }
    return x;
}

function debuffer_hash(h) {
    for(var i in h) {
        if (typeof h[i] === 'string') {
            h[i] = h[i].toString('utf8');
        }
    }
}

// perform asynchronous callbacks for each item in a list and then
// pass the new list off to a final callback
function map(list, each_callback, final_callback) {
    // shortcut any processing if we've got an empty list
    if (list === undefined || list === null || list.length === 0) {
        final_callback(undefined, []);
        return;
    }
    var ilist = [];
    var lsize = list.length;
    var mid_callback = function(err, val){
        if (err) { final_callback(err, undefined); }
        ilist.push(val);
        if (ilist.length == lsize) {
            final_callback(undefined, ilist);
	    }
    };
    for(var i in list) {
        if (list.hasOwnProperty(i)) {
            each_callback(list[i], i, mid_callback);
        }
    }
};

function remove_undef(list) {
    var outlist = [];
    for (var i in list) {
        if (list.hasOwnProperty(i)) {
            if (list[i] != undefined) { outlist.push(list[i]); }
        }
    }
    return outlist;
}

function mark_read_mid(myself, item, key, callback) {
    myself.request('message_mark_read', {"messageid":item}, function(t,a) {
        if (t === "message_mark_read") {
            callback(undefined, item);
        } else {
            callback(undefined, undefined);
        }
    });
}

// reason is 'boot', 'settings' or 'interval'
function spawn_bot(user, pass, reason, success, failure) {
    var should_spawn = false; // default to not spawning
    var now = new Date().getTime();

    if (reason == 'boot' || reason == 'settings') { // always spawn at boot or on settings change
        log.warning("SB: forced respawn: "+reason);
        should_spawn = true;
    }

    // TODO decide if we need port in this mix
    var my_key = user;

    if (ua_sessions[my_key] != undefined) { // we have a flag
        if (ua_sessions[my_key].pass == pass) {
	        log.info("SB: "+user+": alive");
	        ua_sessions[my_key].last = now; // record the last alive time
        } else {
            log.warning("SB: trying to reuse session with incorrect password");
            failure();
            return;
        }
    } else {
        log.info("SB: "+user+": not alive");
        should_spawn = true;
    }

    // don't spawn
    if (! should_spawn) {
        log.info("SB: "+user+": not spawning");
        success();
        return;
    }

    // if we're supposed to spawn because of a respawn...
    // ...and the bot is now alive, log a warning and abort.
    // this fixes the situation where
    // T+0     bot crashes and goes into 5 minute respawn wait
    // T+N<300 bot is restarted by a settings update
    // T+300   bot is respawned without checking aliveness
    // now we have two bots running, stupidly
    if (reason == 'respawn' && ua_sessions[auth] && ua_sessions[auth].process) {
        log.warning(user+": respawn abandoned, bot alive?");
        success();
        return;
    }

    // TODO figure out how to kill the existing bot - if any -
    //      without causing race conditions, etc.

        log.warning("starting a new ["+reason+"] bot for "+user+"/"+pass);
        var child = new uaclient.UAClient(log);
        child.exit_on_end = false;
        child.id = 0
        child.shadow = 256;
        child.caching = false;

        child.addListener("announce_message_add", function(a){
            announce_message_add(child, a);
        });

        child.addListener("reply_message_list", function(a){
            var json = uajson.reply_message_list(a, child);
            g_res.writeHead(200, {'Content-Type':'application/json'});
            g_res.end(JSON.stringify(json));
        });
        child.addListener("reply_user_login", function(a){
            log.info("-> LOGGED ON <-, pending folders");
            child.req_folder_list(child, function(){
                child.req_user_list(child, success);
            });
        });
        child.addListener("reply_user_login_invalid", function(a){
            log.warning("Authentication failure, returning 401");
            delete ua_sessions[user];
            failure();
        });

        // when we get the finished event, remove ourselves
        child.addListener('finished', function(data, code){
            log.warning("finished "+code);
            log.warning(sys.inspect(data));
            delete ua_sessions[my_key];
        });

        child.addListener('folder-cache', function(a, ah){
            // should we clear the cache here?
            g_folders = {};
            for(var i in ah) {
                if (ah.hasOwnProperty(i)) {
                    var fname = i.toLowerCase();
                    var fid = ah[i];
                    g_folders[fname] = fid;
                }
            }
        });

        ua_sessions[my_key] = { session: child, last: now, pass: pass };
        child.connect(user, pass, config['ua_host'], config['ua_port']);
}

function get_user_info(auth, callback) {
    callback();
}

function get_folders(uaclient, callback) {
    uaclient.request('folder_list', {"searchtype":3}, function(t, a) {
        var raw_json = uajson.reply_folder_list(a, uaclient);
        callback(raw_json);
    });
}

function get_unread_folders(uaclient, callback) {
    get_folders(uaclient, function(raw_json) {
        var json = [];
        for (var i in raw_json) {
            if (raw_json.hasOwnProperty(i) && raw_json[i].unread > 0) {
                json.push(raw_json[i]);
            }
        }
        callback(json);
    });
}

// get all messages from a folder
function get_messages(folder, uaclient, callback) {
        var folder_id = uaclient.folders[folder];
        uaclient.request('message_list', {"folderid":folder_id, "searchtype":1}, function(t, a) {
	        var json = uajson.reply_message_list(a, uaclient);
            callback(json);
        });
}

// get the unread messages from a folder
function get_unread_messages(folder, uaclient, callback) {
    var folder_id = uaclient.folders[folder];
    uaclient.request('message_list', {"folderid":folder_id, "searchtype":1}, function(t, a) {
        var raw_json = uajson.reply_message_list(a, uaclient);
        var json = [];
        for (var i in raw_json) {
            if ( raw_json.hasOwnProperty(i) &&
                !raw_json[i].hasOwnProperty('read')) {
                json.push(raw_json[i]);
            }
        }
        callback(json);
    });
}

// this expects to be an (e, v) type callback
function get_message_body(mid, uaclient, callback) {
    if (g_bodies[mid] === undefined) {
        uaclient.request('message_list', {"messageid": mid}, function(t, a) {
	        var raw_msg = uajson.reply_message_list(a, uaclient);
            g_bodies[mid] = raw_msg[0];
	        callback(undefined, raw_msg[0]);
	    })
    } else {
        callback(undefined, g_bodies[mid]);
    }
}

function get_full_unread_messages(folder, uaclient, callback) {
    get_unread_messages(folder, uaclient, function(json) {
        map(json, function(item, index, callback) {
            get_message_body(item.id, uaclient, callback)
        }, function(error, newlist) {
            callback(newlist);
        });
    });
}

function app(app) {
    app.post('/message/read', function(req, res) {
            log.info(req.body);
        var messages = req.body;
        log.info(sys.inspect(messages));
        var my_key = req.remoteUser;
        var myself = ua_sessions[my_key].session;
        map(messages, function(f, i, c) {
            mark_read_mid(myself, f, i, c);
        }, function(e, newlist) {
            var outlist = remove_undef(newlist);
            res.writeHead(200, {'Content-Type':'application/json'});
            res.end(JSON.stringify({"count": outlist.length}));
        });
    });

    app.get('/message/:id', function(req,res){
        var my_key = req.remoteUser;
        var myself = ua_sessions[my_key].session;
        myself.request('message_list', {"messageid":parseInt(req.params.id, 10)}, function(t, a) {
                if (t == 'message_list') {
		            var json = uajson.reply_message_list(a, myself);
                    res.writeHead(200, {'Content-Type':'application/json'});
	                res.end(JSON.stringify(json[0])); // only one
                } else {
                    res.writeHead(404, {'Content-Type':'application/json'});
	                res.end(JSON.stringify({"error":"no such message"}));
                }
        });
    });

    app.get('/folders/unread', function(req,res){
        log.warning("Auth OK, requesting a folder list");
        // tricky!
        var my_key = req.remoteUser;
        var myself = ua_sessions[my_key].session;
        get_unread_folders(myself, function(json) {
            res.writeHead(200, {'Content-Type':'application/json'});
            res.end(JSON.stringify(json));
        });
    });

    app.get('/folders/subscribed', function(req,res){
        log.warning("Auth OK, requesting a folder list");
        // tricky!
        var my_key = req.remoteUser;
        var myself = ua_sessions[my_key].session;
        myself.request('folder_list', {"searchtype":3}, function(t, a) {
	            var raw_json = uajson.reply_folder_list(a, myself);
                var json = [];
                for (var i in raw_json) {
                    if (raw_json.hasOwnProperty(i) &&
                        raw_json[i].subscribed) {
                        json.push(raw_json[i]);
                    }
                }
                res.writeHead(200, {'Content-Type':'application/json'});
                res.end(JSON.stringify(json));
        });
    });

    app.get('/folders', function(req,res){
        log.warning("Auth OK, requesting a folder list");
        // tricky!
        var my_key = req.remoteUser;
        var myself = ua_sessions[my_key].session;
        get_folders(myself, function(json) {
            res.writeHead(200, {'Content-Type':'application/json'});
            res.end(JSON.stringify(json));
        });
    });

    app.get('/system', function(req, res){
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({"banner":"No banner here"}));
    });

    app.get('/user', function(req, res){
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({"name":req.remoteUser}));
    });

    app.get('/folder/:name/unread', function(req,res){
        var folder = req.params.name;
        var my_key = req.remoteUser;
        var myself = ua_sessions[my_key].session;
        get_unread_messages(folder, myself, function(json) {
            res.writeHead(200, {'Content-Type':'application/json'});
            res.end(JSON.stringify(json));
        });
    });

    app.get('/folder/:name/unread/full', function(req,res){
        var folder = req.params.name;
        var my_key = req.remoteUser;
        var myself = ua_sessions[my_key].session;
        get_full_unread_messages(folder, myself, function(json) {
            res.writeHead(200, {'Content-Type':'application/json'});
            res.end(JSON.stringify(json));
        });
    });

    app.get('/folder/:name', function(req,res){
        var folder = req.params.name;
        var my_key = req.remoteUser;
        var myself = ua_sessions[my_key].session;
        get_messages(folder, myself, function(json) {
	        res.writeHead(200, {'Content-Type':'application/json'});
	        res.end(JSON.stringify(json));
        });
    });

    app.post('/folder/:name', function(req, res) {
        var post = req.body;
        var my_key = req.remoteUser;
        var myself = ua_sessions[my_key].session;
        var request = { "subject": post.subject, "text": post.body };
        if (post.to !== undefined) {
            var userid = myself.get_user(post.to);
            if (userid !== undefined) {
                request.toid = userid.value;
            } else {
                request.toname = post.to;
            }
        }
        log.info("folder "+req.params.name+" = "+myself.folders[req.params.name]);
        request.folderid = myself.folders[req.params.name];
        log.info(JSON.stringify(request));
        myself.request('message_add', request, function(t, a) {
            log.info("t="+t+", "+JSON.stringify(a));
            if (t == 'message_add') {
                myself.flatten(a);
                res.writeHead(200, {'Content-Type':'application/json'});
                var epoch = new Date().getTime() / 1000;
                res.end(JSON.stringify({
                    "id":a.messageid, "folder":req.params.name,
                    "epoch": epoch, "thread":a.messageid
                }));
            } else {
            // FIXME this needs to be more complex to handle the full range
                res.writeHead(500, {'Content-Type':'application/json'});
                res.end(JSON.stringify({"error":"could not add post"}));
            }
        });
    });

    app.post('/message/:id', function(req, res) {
        var post = req.body;
        var my_key = req.remoteUser;
        var myself = ua_sessions[my_key].session;
        var request = { "replyid": parseInt(req.params.id, 10) };
        if (post.subject !== undefined) {
            request.subject = post.subject;
        }
        if (post.body !== undefined) {
            request.text = post.body;
        };
        if (post.to !== undefined) {
            var userid = myself.get_user(post.to);
            if (userid !== undefined) {
                request.toid = userid.value;
            } else {
                request.toname = post.to;
            }
        }
        log.info("R: "+JSON.stringify(request));
        myself.request('message_add', request, function(t, a) {
            log.info("t="+t+", "+JSON.stringify(a));
            if (t == 'message_add') {
                myself.flatten(a);
                res.writeHead(200, {'Content-Type':'application/json'});
                var epoch = new Date().getTime() / 1000;
                res.end(JSON.stringify({
                    "id":a.messageid, "folder":a.foldername,
                    "epoch": epoch, "thread":a.messageid
                }));
            } else {
            // FIXME this needs to be more complex to handle the full range
                res.writeHead(500, {'Content-Type':'application/json'});
                res.end(JSON.stringify({"error":"could not add post"}));
            }
        });
    });

    app.get('/threads/unread', function(req, res) {
        var my_key = req.remoteUser;
        var myself = ua_sessions[my_key].session;
        get_unread_folders(myself, function(json) {
            map(json, function(item, index, callback) {
                log.info("recursing into "+sys.inspect(item));
                get_unread_messages(item.folder, myself, function(v){
                    callback(undefined, v);
                });
            }, function(error, newlist) {
                res.writeHead(200, {'Content-Type':'application/json'});
                var flattened = newlist.reduce(function(a,b){
                    return a.concat(b);
                });
                flattened.sort(function(a, b) {
                    if (a.subject == b.subject) {
                        return a.id - b.id;
                    }
                    return a.subject < b.subject ? -1 : 1;
                });
                res.end(JSON.stringify(flattened));
            });
        });
    });

    app.get('/UAcebook/*', staticFiles('.'));
}

function reaper() {
    var now = new Date().getTime();
    for(i in ua_sessions) {
        if (ua_sessions.hasOwnProperty(i) &&
            now - ua_sessions[i].last > SESSION_TIMEOUT) {
            log.info("reaping session for "+i);
            ua_sessions[i].session.stream.end();
            log.info(sys.inspect(ua_sessions[i].session.stream));
            delete ua_sessions[i];
        }
    }
}

// call the reaper every 15 seconds
setInterval(reaper, 15000);

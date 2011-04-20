var jade = require('jade');
var sys = require('sys');
var uaclient = require('uaclient');
var redisFactory = require('redis-node');
var connect = require('./connect/lib/connect/index');
var spawn = require('child_process').spawn;
var fs = require('fs');
var Log = require('log'), log = new Log(Log.WARNING);
require('./wordwrap.js');
var uajson = require('./ua.js'); // functions for converting EDF responses to JSON

var uajson = new uajson.uajson;

var g_req;
var g_res;

function cache_folders(child, ting) {
}
function announce_message_add(child, ting) {
    child.flatten(ting);
    sys.puts("AMA for "+child.username);
}

var api_keys = require(process.env.HOME + '/.apikeys.js');

var TooQuickSpawn = 5 * 60 * 1000; // 5 minutes

var redis = redisFactory.createClient();
var h = process.cwd();

var config_json = fs.readFileSync(process.argv[2], 'utf8');
var config = JSON.parse(config_json);

if (config.frequency == undefined) {
    config.frequency = {"7200": "Two hours", "14400":"Four hours"};
}

var server = connect.createServer(
    connect.logger({ format: ':method :url' }),
    connect.bodyDecoder(),
    connect.errorHandler({ dumpExceptions: true, showStack: true })
);
server.use(connect.basicAuth(authenticate, 'uajson'));
server.use('/', connect.router(app));

server.listen(config.port);
log.info('Connect server listening on port '+config.port);

// holds information about our child bots
var ua_sessions = {};

// temporary fix for the broken packet handling
// inspired by a smart cheese
function serial_mget (redis, list, final_callback) {
    var ilist = new Array;
    var xlist = new Array;
    var lsize = list.length;
    for(var i=0; i++; i<lsize) { xlist[i] = 1; }

    var mid_callback = function(i, lsize) {
        var q = i;
        return function(err, val){
	        if (err) final_callback(err, undefined);
	        ilist.push(val);
            xlist[q] = ilist.length - 1; // index of key in the list
	        if (ilist.length == lsize) {
                var nlist = new Array;
                for(var i in xlist) {
                    nlist[i] = ilist[xlist[i]]; // transpose keys
                }
	            final_callback(undefined, nlist);
		    }
        };
    };
    // perform all the lookups
    // TODO does this need to be in a transaction?
    for(var i in list) {
        redis.get(list[i], mid_callback(i, lsize));
    }
}

function authenticate(user, pass, success, failure) {
    log.info('authinfo is '+user+':'+pass+"; "+failure);
    spawn_bot(user, pass, 'http_auth', success, failure);
}

function output_message(req, res, x, t) {
    var template = t;
    if (t == undefined) { template = 'message.html'; } // default to the full page
    var a = JSON.parse(x);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    log.info("TO="+a.m_toname);
    var to = a.m_toname == undefined ? undefined : a.m_toname;
    d = new Date(a.m_date * 1000);
    b = d.toLocaleString();
    c = b.substr(16,5) +', '+ b.substr(0,3) +' '+ b.substr(8,2) +'/' + ('00'+(1+d.getMonth())).substr(-2);
    summary = a.foldername+'/'+a.message+' ('+a.m_msgpos+'/'+a.nummsgs+') at '+c;
    jade.renderFile('message.html', { locals: {
        summary: summary, from: a.m_fromname, to: to,
        subject: a.m_subject, body: a.m_text,
        wrapped: String.wordwrap(a.m_text)
        }}, function(err, html){
        res.end(html);
    });
}

function buffer_to_strings(x) {
    for(var i in x) {
        if (typeof x === "buffer") {
            x[i] = x[i].toString('utf8');
        }
    }
    return x;
}

function output_links(req, res, x) {
    // convert our array of buffers to the JSON strings
    buffer_to_strings(x);

    var posts = [];
    for(var i in x) {
        try {
        m = JSON.parse(x[i]);
        } catch(e) {
            log.critical(sys.inspect(x[i]));
            process.exit(42);
        }
	    d = new Date(m.m_date * 1000);
	    b = d.toLocaleString();
	    c = b.substr(16,5) +', '+ b.substr(0,3) +' '+ b.substr(8,2) +'/' + ('00'+(1+d.getMonth())).substr(-2);
        m.nicedate = c;
        m.flat_text = m.m_text.replace(/\n/g,' &sect; ');
        if (m.flat_text.length > 60) {
            m.flat_text = m.flat_text.substr(0,59) + '...';
        }
        m.to = (m.m_toname == undefined) ? '&nbsp;' : m.m_toname;
        m.wrapped = String.wordwrap(m.text).replace(/\n\s*\n/g, "<br/><br/>");
        posts.push(m);
    }
    log.info(sys.inspect(posts[0]));

    jade.renderFile('list.html', { locals: { posts: posts } },
        function(err, html){ 
        log.warning(err);
        res.end(html); 
    });
}

function debuffer_hash(h) {
    for(var i in h) {
        if (typeof h[i] === 'string') {
            h[i] = h[i].toString('utf8');
        }
    }
}

// reason is 'boot', 'settings' or 'interval'
function spawn_bot(user, pass, reason, success, failure) {
    var should_spawn = false; // default to not spawning
    var now = new Date().getTime();

    if (reason == 'boot' || reason == 'settings') { // always spawn at boot or on settings change
        log.warning("SB: forced respawn: "+reason);
        should_spawn = true;
    }

    if (ua_sessions[user] != undefined) { // we have a flag
        log.info("SB: "+user+": alive");
        ua_sessions[user].last = now; // record the last alive time
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

//        child.addListener("folders", cache_folders);
        child.addListener("announce_message_add", function(a){
            announce_message_add(child, a);
        });

        child.addListener("reply_folder_list", function(a){
            var json = uajson.reply_folder_list(a, child);
            g_res.writeHead(200, {'Content-Type':'text/html'});
            jade.renderFile('folders.html', { locals: {"a":json, "b":sys.inspect(a)} },
                function(err, html){
                    g_res.end(html);
                });
        });
        child.addListener("reply_user_login", function(a){
            log.info("-> LOGGED ON <-, call the HTTP success bits!");
            success();
        });
        child.addListener("reply_user_login_invalid", function(a){
            log.warning("Authentication failure, returning 401");
            ua_sessions[user] = undefined;
            failure();
        });

        // when we get the finished event, remove ourselves
        child.addListener('finished', function(data, code){
            log.warning("finished "+code);
            log.warning(sys.inspect(data));
            ua_sessions[user] = undefined;
        });

        child.addListener('folders', function(){
                log.info("<folders> should be cached or ignored");
        });

        ua_sessions[user] = { session: child, last: now };
        child.connect(user, pass, config['ua_host'], config['ua_port']);
}

function spawn_bots(reason) {
    sys.puts("Nothing here, bots are spawned on demand.");
}

spawn_bots('boot');
setInterval(function(){spawn_bots('respawn')}, 60 * 1000);

function get_user_info(auth, callback) {
    callback();
}

function app(app) {
    app.get('/m/:id', function(req, res){
        redis.get(req.params.id, function(err, x){
            if (err) { throw(err); }
            if (x != undefined) {
                output_message(req, res, x);
            } else {
                res.writeHead(302, { Location: '/expired' });
                res.end();
            };
        });
        console.log('return message '+req.params.id)
    });
    app.get('/l/:id', function(req, res){
        // we're returning HTML, let's tell the browser that
        res.writeHead(200, { 'Content-Type': 'text/html' });
        redis.zrange('sorted:'+req.params.id, 0, -1, function(err, x){
            if (err == undefined) {
                if (x.length > 0) {
                    serial_mget(redis, x, function(err, messages){
                        if (err) throw(err);
                        output_links(req, res, messages);
                    });
                } else {
                    jade.renderFile('empty.html', {}, function(e, h){
                        if (e) throw(e);
                        res.end(h)
                    });
                }
            }
        });
        console.log('return list '+req.params.id)
    });
    app.get('/folders', function(req,res){
        g_req = req;
        g_res = res;
        log.warning("Auth OK, requesting a folder list");
        res.writeHead(200, {'Content-Type':'text/html'});
        ua_sessions['rjp'].session.request('folder_list', {"searchtype":3});
    });
}


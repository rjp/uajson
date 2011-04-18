var jade = require('jade');
var sys = require('sys');
var uaclient = require('uaclient');
var redisFactory = require('redis-node');
var connect = require('connect');
var auth = require('connect-auth');
var spawn = require('child_process').spawn;
var fs = require('fs');
var Log = require('log'), log = new Log(Log.INFO);
require('./wordwrap.js');

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
    auth([
        auth.Basic({validatePassword: authenticate, realm: 'uanotify'})
    ]),
    connect.router(app),
    connect.errorHandler({ dumpExceptions: true, showStack: true })
);

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
    log.info('pass is '+pass);
    log.info('getting the key auth:'+user);
    redis.get('auth:'+user, function(err, result) {
        var real_pass = result.toString('utf8');
        log.info('real pass is '+real_pass);
        if (pass == real_pass) {
            log.info('AUTHENTICATED, PROCEEDING');
            success();
        } else {
            failure();
        }
    });
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
function spawn_bot(user, reason) {
    var should_spawn = false; // default to not spawning
    var now = new Date().getTime();

    if (reason == 'boot' || reason == 'settings') { // always spawn at boot or on settings change
        should_spawn = true;
    }

    if (ua_sessions[user] != undefined) { // we have a flag
        log.info(user+": alive");
        ua_sessions[user].last = now; // record the last alive time
    } else {
        log.info(user+": not alive");
        should_spawn = true;
    }

    // don't spawn 
    if (! should_spawn) { 
        log.info(user+": not spawning");
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
        return;
    }

    // TODO figure out how to kill the existing bot - if any -
    //      without causing race conditions, etc.

    get_user_info(user, function(folders, subs, profile, sublist) {
        var b = []; for(var z in folders) b.push(z); b.sort();
        // active:users got "corrupted" somehow but not in redis. uh?
        // abort the whole shooting match if we get an undefined ua:name
        if (profile['ua:user'] === undefined) {
            log.critical("active:users corrupted again, undefined: "+user);
            process.exit(99);
        }
        log.warning("starting a new ["+reason+"] bot for "+user+"/"+profile['ua:user']);
        profile['auth:name'] = user;
        profile['ua:server'] = config.ua_host;
        profile['ua:port'] = config.ua_port;
        profile['url:base'] = config.url_base;

        var child = new uaclient.UAClient(log);
        child.exit_on_end = false;
        child.id = 0
        child.shadow = 256;

//        child.addListener("folders", cache_folders);
        child.addListener("announce_message_add", function(a){
            announce_message_add(child, a);
        });

        // when we get the finished event, remove ourselves
        child.addListener('finished', function(){
            log.warning("FINISHED, WIPING MY BRAINS");
            ua_sessions[user] = undefined;
        });

        var pass = (user == 'rjp' ? 'rjp' : 'bot');

        child.connect(user, pass, config['ua_host'], config['ua_port']);

        ua_sessions[user] = { session: child, last: now };
    });
}

function spawn_bots(reason) {
    sys.puts("Nothing here, bots are spawned on demand.");
    spawn_bot('rjp', 'flanges');
    spawn_bot('bot', 'whores');
}

spawn_bots('boot');
setInterval(function(){spawn_bots('respawn')}, 60 * 1000);

function get_user_info(auth, callback) {
    blank_user = { 
        'ua:user': '', 'ua:pass': '', 'notify:type': 'Notifo', 
        'notify:dest': '', 'notify:freq': 7200, 'ua:markread': 0
    };
    log.info('fetching the hash for user:'+auth);
    redis.sismember('active:users', auth, function(err, isactive) {
    redis.hgetall('user:'+auth, function(err,x){
        log.info(sys.inspect(x));
        debuffer_hash(x);

        // if we don't have a notify:type, this must be a new user
        // create one from our blank template and give them no subs
        // mark them as having no folders for printing in the template
        if (x == undefined || x['notify:type'] == undefined) {
            log.info("User doesn't exist in the store, creating a blank one");
            for(var z in blank_user) {
                redis.hset('user:'+auth, z, blank_user[z], function(){});
            }
            redis.del('user:'+auth+':subs', function(){});
            x = blank_user;
        }
        x['active'] = isactive;

        redis.smembers('user:'+auth+':folders', function(err, folders){
            debuffer_hash(folders);
            log.info(sys.inspect(folders));
            if (err == undefined) {
                // now we need the subscribed folders
                redis.smembers('user:'+auth+':subs', function(err, subs){
                    if (err) { 
                        log.warning('ERROR '+err);
                        throw(err);
                    }
                    debuffer_hash(subs);
                    my_subs = []
                    for (var z in subs) { my_subs[z] = subs[z]; }
                    // convert the array into a hash for quick existence checking
                    var subhash = {}; for(var z in my_subs) { subhash[my_subs[z]] = 1; }
                    log.info(sys.inspect(subhash));
                    if (err == undefined) {
                        // GRIEF
                        callback(folders, subhash, x, my_subs);
                    }
                });
            }
        });
    });
    });
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
    app.get('/profile', function(req,res,params){
        req.authenticate(['basic'], function(err, authx){
            var auth = req.getAuthDetails().user.username;
            log.info('AUTHENTICATED AS '+auth);
            res.writeHead(200, {'Content-Type':'text/html'});
            get_user_info(auth, function(folders, subs, profile, sublist){
                var b = []; for(var z in sublist) { b.push(sublist[z]); } b.sort();
                log.info(sys.inspect(b));
                jade.renderFile('profile.html', { locals: { profile: profile, folders: folders, subs: subs, sublist: sublist, freq: config.frequency, s_f: b.join(', ') } },
                    function(err, html){ 
                    log.info(err);
                    res.end(html); 
                });
            });
        });
    });
    app.post('/updatefolders', function(req,res){
        req.authenticate(['basic'], function(err, authx){
            var auth = req.getAuthDetails().user.username;
            redis.del('user:'+auth+':subs', function(){
                for(var z in req.body) {
                    log.info("parameter "+z+" = "+req.body[z]);
                    if (z.substr(0,4) == 'sub_') {
                        redis.sadd('user:'+auth+':subs', req.body[z]);
                    }
                }
            });

            res.writeHead(302, { Location: '/profile' });
            res.end();
        });
    });
    app.post('/update', function(req,res){
        req.authenticate(['basic'], function(err, authx){
            var auth = req.getAuthDetails().user.username;
            var hash = {};
            hash['ua:user'] = req.body.user;
            hash['ua:pass'] = req.body.pass;
            hash['notify:type'] = req.body.type;
            hash['notify:dest'] = req.body.dest;
            hash['notify:freq'] = req.body.freq;
            hash['ua:markread'] = req.body.markread;
            for(var z in hash) {
                redis.hset('user:'+auth, z, hash[z], function(){});
            }
            // stop any UA session they have running and start a new one
            if (ua_sessions[auth]) { 
                log.info("killing old bot session for "+auth);
                ua_sessions[auth].process.kill();
            } 
            if (req.body.active) {
                redis.sadd('active:users', auth, function(){});
                spawn_bot(auth, 'settings');
            } else {
                redis.srem('active:users', auth, function(){});
                log.info("not spawning a new bot for "+hash['ua:user']);
            }

            log.info(sys.inspect(hash));
            res.writeHead(302, { Location: '/profile' });
            res.end();
        });
    });
    app.get('/folders', function(req,res){
        req.authenticate(['basic'], function(err, authx){
            var auth = req.getAuthDetails().user.username;
            res.writeHead(200, {'Content-Type':'text/html'});
            // TODO get the user folder subscription somewhere
            get_user_info(auth, function(folders, subs, profile, sublist){
                var b = []; 
                var safe_folders = {};
                for(var z in folders) {
                    var q = folders[z];
                    b.push(q);
                    safe_folders[q] = q.replace(/[^a-zA-Z0-9]/g, ':')                    
                    log.info("SF "+q+" = "+safe_folders[q]);
                }
                b.sort();
                log.info("Sorted B = "+ sys.inspect(b));
                jade.renderFile('folders.html', { locals: { profile: profile, folders: folders, fkeys: b, subs: subs, safe: safe_folders } },
                    function(err, html){ 
                    log.warning(err);
                    res.end(html); 
                });
            });
        });
    });
    app.get('/settings', function(req,res){
        req.authenticate(['basic'], function(err, authx){
            var auth = req.getAuthDetails().user.username;
            res.writeHead(200, {'Content-Type':'text/html'});
            // TODO get the user folder subscription somewhere
            get_user_info(auth, function(folders, subs, profile, sublist){
                var z;
                var s_f = []; for(var z in config.frequency) s_f.push(z); s_f.sort();

                jade.renderFile('settings.html', { 
                        locals: { 
                            profile: profile, folders: folders, 
                            subs: subs, f_keys: s_f,
                            freq: config.frequency
                        } 
                    }, function(err, html){ 
                        res.end(html); 
                    }
                );
            });
        });
    });
    app.get('/noauth', function(req, res) {
        res.writeHead(200, {'Content-Type': 'text/html'});
        res.end('NOT AUTHENTICATED, BUGGER OFF!');
    });
    app.get('/expired', function(req, res) {
        res.writeHead(200, {'Content-Type': 'text/html'});
        jade.renderFile('expired.html', {locals: {}}, function(err, html) {
            res.end(html);
        })
    });
}


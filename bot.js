var sys = require('sys');
var uaclient = require('uaclient');
var notifo = require('notifo');
var redis = require('redis');
var connect = require('connect');
var api_keys = require(process.env.HOME + '/.apikeys.js');
require('./Math.uuid.js');

var notifo_user = process.argv[4];

// create this up here
var notification = new notifo({
    'username': keys.notifo.user,
    'secret': keys.notifo.secret
});

var r = redis.createClient();
var username = process.argv[2];

var safe_username = username.replace(/[^A-Za-z0-9]/g, '_');

var token = new Date().getTime().toString(36);
var unikey = [safe_username, process.pid, token].join(':');

var nextid = [unikey, 'nextid'].join(':');
var list = [unikey, 'list', ''].join(':');

// start a new list to avoid collisions / race conditions
function new_list() {
    sys.puts("incrementing "+nextid);
    r.incr(nextid, function(err, id) {
        sys.puts("err is "+err);
        notifybot.id = id;
        sys.puts("storing new items in "+list+id);
    });
}

function buffer_to_strings(x) {
    for(i in x) {
        x[i] = x[i].toString('utf8');
    }
    return x;
}

function notify_list(e, x) {
    buffer_to_strings(x);
    for(i in x) {
        item = JSON.parse(x[i]);
        sys.puts(sys.inspect(item));
    }
    old_list = list + notifybot.id
    notification.send({
        title: 'UA New messages',
        to: notifo_user, // bleh, where do we get this from?
        msg: x.length+' new messages',
        uri: 'http://backup.frottage.org:9980/l/'+old_list
    }, function(err, response){
        if (err) { throw err; }
        else { console.log(response); }
    });
    new_list();
}

function periodic() {
    old_list = list + notifybot.id
    // if we have items, send them to notify_list
    r.llen(old_list, function(e, x) {
        if (x > 0) {
            r.lrange(old_list, 0, -1, notify_list);
        }
    });
}

notifybot = new uaclient.UAClient;
notifybot.id = 0

function extend(v1, v2) {
    for (var property in v2) {
        sys.puts("copying "+property+" from v2 to v1");
        v1[property] = v2[property];
    }
    return v1;
}

// semi-flatten an EDF tree into a more usable JS object
function flatten(q, prefix) {
    for(i=0;i<q.children.length;i++){
        if (prefix == undefined) {
            q[q.children[i].tag] = q.children[i].value
        } else {
            q[prefix + q.children[i].tag] = q.children[i].value
        }
    };
    return q;
}

function reply_message_list(a) {
    // hoist the message part into the root with an m_ prefix
    x = notifybot.getChild(a, 'message');
    flatten(a);
    flatten(x, 'm_');
    extend(a, x);
    // create a link to the full content of the message as a hash
    // hopefully this is obscure enough to avoid guessing URLs
//     md5 = crypto.createHash('md5');
//     md5.update(JSON.stringify(a));
//     link = md5.digest('base64');
    link = Math.uuid();
    a.link = link;
    // TODO check this works
    r.rpush(list+notifybot.id, JSON.stringify(a), function(){});
    // TODO check this works
    r.set(link, JSON.stringify(a), function(){});
}

function announce_message_add(a) {
    notifybot.flatten(a);
    notifybot.request('message_list', {messageid: a['messageid']});
}

notifybot.addListener("announce_message_add", announce_message_add);
notifybot.addListener("reply_message_list", reply_message_list);

sys.puts("setting "+nextid+" to 0 and starting our count there");
r.set(nextid, 0);
setInterval(periodic, 1*60*1000);
notifybot.connect(process.argv[2], process.argv[3], 'ipz.frottage.org', 8080);
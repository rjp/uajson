uaJSON
======
node.js based implementation of the UA3 spec interfacing to UA2.

Currently implements the bare minimum that lets UAcebook work.

GET   /message/:id
GET   /folders/unread
GET   /folders/subscribed
GET   /folders
GET   /system
GET   /user
GET   /folder/:name/unread
GET   /folder/:name
POST  /message/read
POST  /folder/:name
POST  /message/:id

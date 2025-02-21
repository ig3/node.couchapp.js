# @ig3/couchapp

DEPRECATED: while it will still work witch CouchDB 3.x, support for `vhost`
and rewrite rules will not be included in CouchDB 4.x and, therefore,
couchapps will not work with CouchDB 4.x.

An alternative is to use nginx or equivalent to proxy access to the
application, serve all the static content (the couchapp attachments)
directly from nginx and implemnt all the rewrite rules in nginx, proxying
only the database access to the CouchDB server. This is, in many ways,
simpler than implementing a couchapp.

@ig3/couchapp is a command line tool for building and deploying couchapps.

It is based on
[node.couchapp.js](https://github.com/mikeal/node.couchapp.js).

## Installation

@ig3/couchapp should be installed globally and locally in the package that
uses it. At least, that's what the old docs say. Now, it should suffice to
install it locally and use `npx` to run it from the command line.

To install the couchapp command so that it is available globally:

<pre>
$ npm install -g @ig3/node.couchapp.js
</pre>

To install the couchapp package locally in a package:

<pre>
$ npm install @ig3/node.couchapp.js
</pre>

<pre>
$ couchapp help
couchapp -- utility for creating couchapps

Usage - old style with single app.js:
  couchapp &lt;command> app.js http://localhost:5984/dbname [opts]

Usage - new style with multiple app files:
  directory based config specified by switch - multiple app files and pre- and post-processing capability)
  couchapp -dc &lt;<command> &lt;appconfigdirectory> http://localhost:5984/dbname

Commands:
  push   : Push app once to server.
  sync   : Push app then watch local files for changes.
  boiler : Create a boiler project.
  serve  : Serve couchapp from development webserver
            you can specify some options
            -p port  : list on port portNum [default=3000]
            -d dir   : attachments directory [default='attachments']
            -l       : log rewrites to couchdb [default='false']
</pre>

<pre>
Directory-based config:

  -dc (directory config) switch uses multiple config files in the directory specified by &lt;appconfigdirectory>

  Any file with a filename that begins with "app" will be executed.

  Additionally

  (i) if the app config directory contains file beforepushsync.js then this will be executed before any of the app files have run
  (ii) if the app config directory contains file afterpushsync.js then this will be executed after all of the app files have run

  beforepushsync.js and afterpushsync.js can be used to perform any before/after processing, using node.js code for example.

  The sample afterpushsync.js shows lookup data being added to CouchDB after the CouchApp has been pushed.
</pre>

app.js example:

<pre>
  var couchapp = require('couchapp')
    , path = require('path');

  ddoc = {
      _id: '_design/app'
    , views: {}
    , lists: {}
    , shows: {} 
  }

  module.exports = ddoc;

  ddoc.views.byType = {
    map: function(doc) {
      emit(doc.type, null);
    },
    reduce: '_count'
  }

  ddoc.views.peopleByName = {
    map: function(doc) {
      if(doc.type == 'person') {
        emit(doc.name, null);
      }
    }
  }

  ddoc.lists.people = function(head, req) {
    start({
      headers: {"Content-type": "text/html"}
    });
    send("&lt;ul id='people'>\n");
    while(row = getRow()) {
      send("\t&lt;li class='person name'>" + row.key + "&lt;/li>\n");
    }
    send("&lt;/ul>\n")
  }

  ddoc.shows.person = function(doc, req) {
    return {
      headers: {"Content-type": "text/html"},
      body: "&lt;h1 id='person' class='name'>" + doc.name + "&lt;/h1>\n"
    }
  }
  
  ddoc.validate_doc_update = function (newDoc, oldDoc, userCtx) {
    function require(field, message) {
      message = message || "Document must have a " + field;
      if (!newDoc[field]) throw({forbidden : message});
    };

    if (newDoc.type == "person") {
      require("name");
    }
  }

  couchapp.loadAttachments(ddoc, path.join(__dirname, '_attachments'));
</pre>


Local development server example.

Start the server:

    couchapp serve app.js http://localhost:5984/example_db -p 3000 -l -d attachments

Now you can access your couchapp at http://localhost:3000/ . Code, hack and when you are
happy with the result simply do:

    couchapp push app.js http://localhost:5984/example_db

## Changes

### 0.11.4 - 20220330

Update README: installation

### 0.11.3 - 20220330

Remove support for coffeescript

Remove dependency: coffee-script

### 0.11.2 - 20220330

Remove dependency: request

### 0.11.1 - 20220330

Update dependency: nano

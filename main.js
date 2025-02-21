// Copyright 2022 Ian Goodacre
//
// This is a derivative of original work by Mikeal Rogers.
//
// Copyright 2015 Mikeal Rogers
//
//    Licensed under the Apache License, Version 2.0 (the "License");
//    you may not use this file except in compliance with the License.
//    You may obtain a copy of the License at
//
//        http://www.apache.org/licenses/LICENSE-2.0
//
//    Unless required by applicable law or agreed to in writing, software
//    distributed under the License is distributed on an "AS IS" BASIS,
//    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//    See the License for the specific language governing permissions and
//    limitations under the License.

var path = require('path')
  , fs = require('fs')
  , watch = require('watch')
  , crypto = require('crypto')
  , mimetypes = require('./mimetypes')
  , spawn = require('child_process').spawn
  ;

// Common request headers
var h = function () {
  return JSON.parse(JSON.stringify({'content-type':'application/json', 'accept-type':'application/json'}));
}

// The request pacakge is deprecated and unmaintained for several years.
// See: https://github.com/request/request/issues/3142
// This is a simple replacement, adequate for immediate needs
const request = function (opts, callback) {
  const agent = (opts.uri.toLowerCase().startsWith('https')) ? 
    require('https') : require('http');

  const url = require('url').parse(opts.uri);

  const requestOptions = {
    host: url.hostname,
    port: url.port,
    method: (opts.method && opts.method === 'PUT') ? 'put' : 'get',
    path: url.pathname + (url.search || ''),
    auth: url.auth
  };

  console.log('requestOptions: ', requestOptions);

  const req = agent.request(requestOptions, (res) => {
    const bufs = [];
    let len = 0;
    res.on('data', chunk => {
      bufs[bufs.length] = chunk;
      len += chunk.length;
    });
    res.on('end', () => {
      console.log('done', Buffer.concat(bufs, len).toString());
      callback(null, res, Buffer.concat(bufs, len).toString());
    });
  });

  req.on('error', function (err) {
    console.log('error: ', err);
    callback(err);
  });
  if (opts.headers) {
    Object.keys(opts.headers).forEach(header => {
      req.setHeader(header, opts.headers[header]);
    });
  }
  if (opts.body) {
    req.setHeader('content-length', Buffer.byteLength(opts.body));
    req.write(opts.body);
  }
  req.end();
};
  
/**
 * Recursively load directory contents into ddoc
 *
 * It's really convenient to see the main couchapp code in single file,
 * rather than mapped into little files in lots of directories like
 * the python couchapp. But there are definitely cases where we might want 
 * to use some module or another on the server side. This addition
 * loads file contents from a given directory (recursively) into a js 
 * object that can be added to a design document and require()'d in 
 * lists, shows, etc. 
 *
 * Use couchapp.loadFiles() in app.js like this:
 *
 *    ddoc = {
 *        _id: '_design/app'
 *      , views: {}
 *      , ...
 *      , lib: couchapp.loadFiles('./lib')
 *      , vendor: couchapp.loadFiles('./vendor')
 *    }
 *
 * Optionally, pass in operators to process file contents. For example, 
 * generate mustache templates from jade templates.
 *
 * In yourapp/templates/index.jade
 *  
 * !!!5
 * html
 *   head
 *     //- jade locals.title
 *     title!= title
 *   body
 *     .item
 *       //- mustache variable for server-side rendering
 *       h1 {{ heading }}
 *
 * in yourapp/app.js
 * var couchapp = require('couchapp')
 *   , jade = require('jade')
 *   , options = {
 *       , operators: [
 *           function renderJade (content, options) {
 *             var compiler = jade.compile(content);
 *             return compiler(options.locals || {});
 *           }
 *         ]
 *       , locals: { title: 'Now we\'re cookin with gas!' }
 *   };
 *
 * ddoc = { ... };
 * 
 * ddoc.templates = loadFiles(dir, options);
 */

function loadFiles(dir, options) {
  var listings = fs.readdirSync(dir)
    , options = options || {}
    , obj = {};

  listings.forEach(function (listing) {
    var file = path.join(dir, listing)
      , prop = listing.split('.')[0] // probably want regexp or something more robust
      , stat = fs.statSync(file);

      if (stat.isFile()) { 
        var content = fs.readFileSync(file).toString();
        if (options.operators) {
          options.operators.forEach(function (op) {
            content = op(content, options);
          });
        }
        obj[prop] = content;
      } else if (stat.isDirectory()) {
        obj[listing] = loadFiles(file, options);
      }
  });

  return obj;
}

/**
 * End of patch (also see exports and end of file)
 */

function loadAttachments (doc, root, prefix) {
  doc.__attachments = doc.__attachments || []
  try {
    fs.statSync(root)
  } catch(e) {
    throw e
    throw new Error("Cannot stat file "+root)
  }
  doc.__attachments.push({root:root, prefix:prefix});
}

function copy (obj) {
  var n = {}
  for (i in obj) n[i] = obj[i];
  return n
}

  
function createApp (doc, cb) {
  var app = {doc:doc}
    , url
    ;
  
  app.fds = {};
  
  app.prepare = function () {
    var p = function (x) {
      for (i in x) {
        if (i[0] != '_') {
          if (typeof x[i] == 'function') {
            x[i] = x[i].toString()
            x[i] = 'function '+x[i].slice(x[i].indexOf('('))
          }
          if (typeof x[i] == 'object') {
            p(x[i])
          }
        }
      }
    }
    p(app.doc);
    app.doc.__attachments = app.doc.__attachments || []
    app.doc.attachments_md5 = app.doc.attachments_md5 || {}
    app.doc._attachments = app.doc._attachments || {}
  }
  var reject = function(err,callback) {
      if ('function' == typeof callback) return callback(err);
      throw err;
  }

  var push = function (callback) {
    console.log('Serializing.')
    var doc = copy(app.doc);
    doc._attachments = copy(app.doc._attachments)
    delete doc.__attachments;
    var body = JSON.stringify(doc)
    console.log('PUT '+url.replace(/^(https?:\/\/[^@:]+):[^@]+@/, '$1:******@'))
    request({uri:url, method:'PUT', body:body, headers:h()}, function (err, resp, body) {
      if (err) return reject(err,callback);
      if (resp.statusCode !== 201) {
        return reject(new Error("Could not push document\nCode: " + resp.statusCode + "\n"+body),callback);
      }
      app.doc._rev = JSON.parse(body).rev
      console.log('Finished push. '+app.doc._rev)
      request({uri:url, headers:h()}, function (err, resp, body) {
        body = JSON.parse(body);
        app.doc._attachments = body._attachments;
        if (callback) callback()
      })
    })
  }
  
  var walkAttachments = function (callback) {
    var revpos
      , pending_dirs = 0
      ;
    
    console.log('Preparing.')
    var doc = app.current;
    for (i in app.doc) {
      if (i !== '_rev') doc[i] = app.doc[i]
    }
    app.doc = doc;
    app.prepare();
    revpos = app.doc._rev ? parseInt(app.doc._rev.slice(0,app.doc._rev.indexOf('-'))) : 0;
    
    app.doc.__attachments.forEach(function (att) {
      watch.walk(att.root, {ignoreDotFiles:true}, function (err, files) {
        pending_dirs += 1;
        var pending_files = Object.keys(files).length;
        for (i in files) { (function (f) {
          fs.readFile(f, function (err, data) {
            f = f.replace(att.root, att.prefix || '').replace(/\\/g,"/");
            if (f[0] == '/') f = f.slice(1)
            if (!err) {
              var d = data.toString('base64')
                , md5 = crypto.createHash('md5')
                , mime = mimetypes.lookup(path.extname(f).slice(1))
                ;
              md5.update(d)
              md5 = md5.digest('hex')
              if (app.doc.attachments_md5[f] && app.doc._attachments[f]) {
                if (app.doc._attachments[f].revpos === app.doc.attachments_md5[f].revpos &&
                    app.doc.attachments_md5[f].md5 === md5) {
                  pending_files -= 1;
                  if(pending_files === 0){
                    pending_dirs -= 1;
                    if(pending_dirs === 0){
                      push(callback);
                    }
                  }
                  return; // Does not need to be updated.
                }
              }
              app.doc._attachments[f] = {data:d, content_type:mime};
              app.doc.attachments_md5[f] = {revpos:revpos + 1, md5:md5};
            }
            pending_files -= 1
            if(pending_files === 0){
              pending_dirs -= 1;
              if(pending_dirs === 0){
                push(callback);
              }
            }
          })
        })(i)}
      })
    })
    if (!app.doc.__attachments || app.doc.__attachments.length == 0) push(callback);
  }

  app.sync = function (toUrl, callback) {
    // A few notes.
    //   File change events are stored in an array and bundled up in to one write call., 
    // this reduces the amount of unnecessary processing as we get a lof of change events.
    //   The file descriptors are stored and re-used because it cuts down on the number of bad change events.
    //   And finally, we check the md5 and only push when the document is actually been changed.
    //   A lot of crazy workarounds for the fact that we basically get an event every time someone
    // looks funny at the underlying files and even reading and opening fds to check on the file trigger
    // more events.
    
    app.push(toUrl, function () {
      var changes = [];
      console.log('Watching files for changes...')
      app.doc.__attachments.forEach(function (att) {
        var pre = att.root
        var slash = (process.platform === 'win32') ? '\\' : '/';
        if (pre[pre.length - 1] !== slash) pre += slash;
        watch.createMonitor(att.root, {ignoreDotFiles:true}, function (monitor) {
          monitor.on("removed", function (f, stat) {
            f = f.replace(pre, '');
            changes.push([null, f]);
          })
          monitor.on("created", function (f, stat) {
            changes.push([f, f.replace(pre, ''), stat]);
          })
          monitor.on("changed", function (f, curr, prev) {
            changes.push([f, f.replace(pre, ''), curr]);
          })
        })
      })
      var check = function () {
        var pending = 0
          , revpos = parseInt(app.doc._rev.slice(0,app.doc._rev.indexOf('-')))
          , dirty = false
          ;
        if (changes.length > 0) {
          changes.forEach(function (change) {
            if (!change[0]) {
              delete app.doc._attachments[change[1]];
              dirty = true;
              console.log("Removed "+change[1]);
            } else {
              pending += 1
              
              fs.readFile(change[0], function (err, data) {
                var f = change[1]
                  , d = data.toString('base64')
                  , md5 = crypto.createHash('md5')
                  , mime = mimetypes.lookup(path.extname(f).slice(1))
                  ;

                md5.update(d)
                md5 = md5.digest('hex')
                pending -= 1
                if (!app.doc.attachments_md5[f] || (md5 !== app.doc.attachments_md5[f].md5) ) {
                  app.doc._attachments[f] = {data:d, content_type:mime};
                  app.doc.attachments_md5[f] = {revpos:revpos + 1, md5:md5};
                  dirty = true;
                  console.log("Changed "+change[0]);
                }
                if (pending == 0 && dirty) push(function () {dirty = false; setTimeout(check, 50)})
                else if (pending == 0 && !dirty) setTimeout(check, 50)
                
              })
            }
            
          })
          changes = []
          if (pending == 0 && dirty) push(function () {dirty = false; setTimeout(check, 50)})
          else if (pending == 0 && !dirty) setTimeout(check, 50)
        } else {
          setTimeout(check, 50);
        }
      }
      setTimeout(check, 50)
    })
  }
  
  app.push = function(toUrl, cb) {
      var _id = doc.app ? doc.app._id : doc._id
      url = toUrl;
      if (url.slice(url.length - _id.length) !== _id) url += '/' + _id;

      request({uri:url, headers:h()}, function (err, resp, body) {
        if (err) throw err;
        if (resp.statusCode == 404) app.current = {};
        else if (resp.statusCode !== 200) return reject(new Error("Failed to get doc\n"+body));

        else app.current = JSON.parse(body)
        walkAttachments(cb)
      })
  }

  cb(app);
}

exports.createApp = createApp
exports.loadAttachments = loadAttachments
exports.bin = require('./bin')
exports.loadFiles = loadFiles

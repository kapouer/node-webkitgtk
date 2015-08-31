node-webkitgtk
==============

Pilot webkitgtk from Node.js with a simple API.

Falls back to jsdom if the module cannot be compiled (with obvious
limitations like inability to render the DOM nor output png or pdf).

Typically, [express-dom](https://github.com/kapouer/express-dom) can run
on webkitgtk's jsdom mode - developers can work on other platforms where
jsdom builds fine.

*this module uses only system-installed, shared libraries*  
it doesn't embed static libraries at all.


Version 2 warning
-----------------

The chainable API has been dropped.

Every chained calls must be replaced by callbacks.

The `.wait()` method can be replaced by `.when()`, but the function must
in turn invoke the callback parameter it receives.

The `.run()` method now behaves like `.runev()` regarding params passing.


Version 3 warning
-----------------

It is no longer possible to cancel requests, change the request uri, or ignore
a request for idle counting, in the `request` event.

It is possible to do it using `filter` and `filterArgs` options of the `load`
method.

Is is not (yet) possible to read or write request headers in that filter function.
That were mostly useless anyway.

There are two advantages of doing so:
  - no longer directly need dbus, cleaner code
  - about 5ms by request was spent waiting for dbus calls

But it's no longer easy to map request uri to other uris using internal data,
especially if that internal data is mutable (for immutable data, filterArgs
can help).


usage
-----

```js
var WebKit = require('webkitgtk');
var fs = require('fs');

// optional, if nothing is set, defaults to :0
var displayOpts = {
  width: 1024,
  height: 768,
  display: "99"
};


// old-style creation
var view = new WebKit();
view.init(displayOpts, function(err, view) {
  view.load(uri, {
    style: fs.readFileSync('css/png.css') // useful stylesheet for snapshots
  }, function(err) {
    if (err) console.error(err);
  }).once('load', function() {
    this.png('test.png', function(err) {
      if (err) console.error(err);
      else console.log("screenshot saved", uri);
    });
  });
});

// short-hand can init display and load
WebKit.load(uri, {
  display: displayOpts, // optional, defaults to :0
  style: fs.readFileSync('css/png.css') // useful stylesheet for snapshots
}).once('idle', function() {
  this.png('test.png'); // this is always the created instance in listeners
  // ...
});
```

A facility for choosing/spawning a display using xvfb

```js
// this spawns xvfb instance
// new-style creation
WebKit("1024x768x16:99", function(err, w) {
  w.load("http://github.com", function(err) {
    w.png('test.png', function(err) {
      // done
    });
  });
});

// this uses a pre-existing display
WebKit(98, function(err, w) {
  w.load("http://google.com");
});

// use pre-existing display 0 by default
Webkit(function(err, w) {
  w.load("http://webkitgtk.org", function(err) {
    w.html(function(err, str) {
      console.log(html);
    });
  });
});

```

Asynchronous (life) event handlers

```js
WebKit
.load("http://localhost/test", {content: "<html><body></body></html>"})
.when("ready", function(cb) {
  this.run(function(className, done) {
    setTimeout(function() {
      document.body.classList.add(className);
      done();
    }, 100);
  }, 'testClass', cb);
})
.when("ready", function(cb) {
  setTimeout(cb, 100);
})
.when("idle", function(cb) {
  // and so on
  cb();
});
```

See test/ for more examples.


use cases
---------

This module is specifically designed to run 'headless'.
Patches are welcome for UI uses, though.

* snapshotting service (in combination with 'gm' module)

* print to pdf service (in combination with 'gs' module)

* static web page rendering

* long-running web page as a service with websockets or webrtc
  communications

* gui widgets (since webkitgtk >= 2.7.4, transparent windows are possible),
  see [the github wiki of node-webkitgtk](https://github.com/kapouer/node-webkitgtk/wiki).


load(uri, opts, cb) options
---------------------------

- cookies  
  string | [string], default none  
  caution: cookies are saved

- width  
  number, 1024
- height  
  number, 768  
  the viewport

- allow  
  "all" or "same-origin" or "none" or a RegExp, default "all"  
  allow requests only matching option (except the document request),
  bypassing 'request' event.  
  This does not allow requests that are rejected by cross-origin policy.

- filter  
  function(uri), returns a boolean, or null, or a string, and is run in browser  
  called for each request, even the initial document request  
  return false to cancel the request (with response status code 0)  
  return true to accept the request without modification  
  return a string to replace the uri by another one  
  return null or undefined to ignore the request (not count it for idle event).

- filterArgs  
  an array of JSON-stringifiable arguments to append to the filter function
  arguments.

- private  
  boolean, default false  
  run in private (a.k.a. incognito) mode.

- images  
  boolean, default true  
  Load images automatically.

- navigation  
  boolean, default false  
  allow navigation within the webview (changing document.location).

- dialogs  
  boolean, default false  
  allow display of dialogs.

- content  
  string, default null  
  load this content with the given base uri.

- script  
  string, default null  
  insert script at the beginning of loaded document.

- style  
  string, default null  
  insert user stylesheet, see  
  http://www.w3.org/TR/CSS21/cascade.html#cascading-order
  
- transparent  
  boolean, default false  
  webkitgtk >= 2.7.4  
  let the background be transparent (or any color set by css on the document)

- decorated  
  boolean, default true  
  show window decorations (title bar, scroll bars)

- ua  
  user-agent string, default to "Mozilla/5.0"

- timeout  
  number, default 30000  
  timeout for load(), in milliseconds

- stall  
  number, default 1000  
  requests not receiving data for `stall` milliseconds are not taken into
  account for deciding `idle` events.

- console  
  boolean, default false  
  Send `console` events (see below).  
  Default listener outputs everything and is disabled by registering a custom
  listener.

- charset  
  string, default "utf-8", previously default was "iso-8859-1"  
  The default text charset used when interpreting content with an unspecified
  charset.  
  Useful to fix Script errors when serving utf-8 encoded javascript files.

- runTimeout  
  number, default 10000  
  Async run() calls will timeout and call back after `runTimeout` ms.  
  Sync run() calls, or runev() calls, are not affected.  
  Can be disabled by setting this param to 0.


init(opts, cb) options
----------------------

`init(display)` can be called instead of passing an object.

- display  
  number for port, or string, (WIDTHxHEIGHTxDEPTH):PORT, default env.DISPLAY  
  checks an X display or framebuffer is listening on that port
  init(display)

- width  
  number, 1024
- height  
  number, 768
  Framebuffer dimensions
- depth  
  number, 32
  Framebuffer pixel depth

- verbose  
  boolean, default false  
  log client errors and stalled requests, otherwise available as
  DEBUG=webkitgtk:timeout,webkitgtk:error.

- cacheDir  
  string, $user_cache_dir/node-webkitgtk  
  path to webkitgtk cache directory.  
  Changing cacheDir can fail silently if webkitgtk lib is already initialized.
  The simplest way to clear the cache is to delete this directory.

- debug  
  boolean, default false  
  shows a real window with a web inspector.  
  As a commodity, *the inspector must be closed* to get the `idle` event fired.

- cookiePolicy  
  string, "always", "never", any other string defaults to "no third party".

If width, height, depth options are given, an xvfb instance listening
given display port will be spawn using `headless` module.

It is advised and safer to monitor xvfb using a proper daemon tool.


pdf() options
-------------

- orientation  
  landscape | portrait, default to portrait

- paper (string)  
  typical values are iso_a3, iso_a4, iso_a5, iso_b5,
  na_letter, na_executive, na_legal, see  
  https://developer.gnome.org/gtk3/stable/GtkPaperSize.html

- paper (object)  
  unit : string, mm|in|pt, default "pt"  
  width : number, default 0  
  height : number, default 0  

- margins (number)  
  in units of points, default implied by paper size

- margins (object)  
  unit : string, mm|in|pt, default "pt"  
  left, top, right, bottom : number, default 0


events
------

All events are on the WebKit instance.

These are lifecycle events:

* ready  
  same as document's DOMContentLoaded event  
  listener()

* load  
  same as window's load event  
  listener()

* idle  
  when all requests are finished, failed, or just hanging, and when the
  gtk loop has been doing nothing for a couple of cycles.  

* unload  
  same as window's unload event  
  listener()

These events happen *once* and *in that order*.

A new *busy* event can happen after *idle* event: it tracks further activity
after idling state, caused by any of:

- setTimeout is finished or cleared
- setInterval is finished or cleared
- xhr is finished or aborted
- animationFrame is finished or cancelled
- a websocket emits a message

It can be used to track updates done by XHR, or long timeouts executed after
page load.

Registering a listener for an event that already happened immediately calls the
new listener.


These events can happen at any moment:

* error  
  this is what is caught by window.onerror  
  listener(message, url, line, column)

* request  
  listener(req) where req.uri, req.headers are read only.  
  The request has already been sent when that event is emitted.

* response  
  listener(res)  
  res have read-only properties uri, mime, status, length, filename, headers.  
  res.data(function(err, buf)) fetches the response data.

* authenticate  
  listener(request) where request.host, request.port, request.realm are
  read-only.  
  request.use(username, password) authenticates  
  request.ignore() ignores authentication  
  Both methods can be called later (asynchronously), but at least one of them
  is supposed to be called if the signal is handled.

* console (deprecated)
  listener(level, ...) where level is 'log', 'error', 'warn' or 'info'.  
  Remaining arguments are the arguments of the corresponding calls to
  console[level] inside the page.  
  Logging everything that comes out of web pages can be annoying, so this is
  disabled by default.  
  This event is deprecated - use `console` load option to enable/disable
  console output instead.


methods
-------

* new Webkit()  
  creates an unitialized instance upon which init() must be called.  
  WebKit is also an EventEmitter.

* WebKit([opts], cb)  
  Same as above.  
  If arguments are given, equals `new WebKit().init(opts, cb)`.

* init([opts], cb)  
  see parameters described above  
  *must be invoked before (pre)load*.  
  Callback receives (err, instance).

* preload(uri, [opts], [cb])  
  load uri into webview  
  scripts are not run, resources are not loaded.  
  These options are not effective: `cookies`, `script`, `allow`.  
  Callback receives (err, instance).

* load(uri, [opts], [cb])  
  load uri into webview  
  see parameters described above.  
  Callback receives (err, instance).

* once(event, listener)   /the EventEmitter interface/

* when(event, actor)  
  Allow queuing of jobs on an event and before next event.  
  The actor receives a unique callback parameter, to be called when done.

* run(sync-script, <param>*, cb)  
  any synchronous script text or global function.  
  If it's a function, multiple parameters can be passed, as long as they are
  serializable.

* run(async-script, <param>*, cb)  
  async-script must be a function with callback as last argument,
  whose arguments will be passed to cb, as long as they are stringifyable.  

* runev(async-script, <param>*, cb)  
  async-script must be a function, it receives an `emit` function as last
  argument, which in turn acts as event emitter: each call emits the named event
  on current instance, and can be listened using view.on(event, listener).  
  The listener receives additional arguments as long as they're stringifyable.  
  Can be used to listen recurring events.  

* png(writableStream or filename, [cb])  
  takes a png snapshot of the whole document right now.  
  If invoked with a filename, save the stream to file.  
  Tip: use custom css to cut portions of the document.

* html(cb)  
  get the whole document html, prepended with its doctype, right now.  
  Callback receives (err, str).

* pdf(filepath, [opts], [cb])  
  print page to file right now  
  see parameters described above.

* unload(cb)  
  Sets current view to an empty document and uri.  
  Emits 'unload' event.

* destroy(cb)  
  does the reverse of init - frees webview and xvfb instance if any.  
  init() can be called again to recover a working instance.


properties
----------

* uri  
  Read-only, get current uri of the web view.

* readyState  
  Read-only: empty, "opening", "loading", "interactive", "complete"  
  Before the first call to .load(uri, cb) it is empty, and before cb is called it
  is opening.


debugging
---------

`DEBUG=webkitgtk node myscript.js`
to print all logs.

In a production environment, it could be useful to set the init option
verbose = true
or, equivalently, the environment variables
DEBUG=webkitgtk:timeout,webkitgtk:error,webkitgtk:warn


This will keep the page running, output console to terminal, and open
a gtk window with inspector open:

```
WebKit({debug: true, verbose: true}, function(err, w) {
  w.load(url, {console: true});
});
```

For debugging of node-webkitgtk itself, please read ./DEBUG.


about plugins
-------------

In webkit2gtk >= 2.4.4, if there are plugins in `/usr/lib/mozilla/plugins`
they are initialized (but not necessarily enabled on the WebView),
and that could impact first page load time greatly (seconds !) - especially if
there's a java plugin.

Workaround:
uninstall the plugin, on my dev machine it was
`/usr/lib/mozilla/plugins/libjavaplugin.so` installed by icedtea.


install
-------

Linux only.

These libraries and their development files must be available in usual
locations.

```
webkit2gtk-3.0 (2.4.x), for node-webkitgtk 1.2.x
webkit2gtk-4.0 (2.6.x to 2.8.x), for node-webkitgtk >= 1.3.0
glib-2.0
gtk+-3.0
libsoup2.4
```

Also usual development tools are needed (pkg-config, gcc, and so on).

On debian/jessie, these packages will pull necessary dependencies:

```
nodejs
npm
libwebkit2gtk-3.0-dev (2.4.x), for node-webkitgtk 1.2.x
libwebkit2gtk-4.0-dev (2.6.x to 2.8.x), for node-webkitgtk >= 1.3.0
```

On fedora/21:

```
nodejs
npm
webkitgtk4-devel
```

On ubuntu/14:
try [the WebKit team ppa](https://launchpad.net/~webkit-team)

License
-------

MIT, see LICENSE file


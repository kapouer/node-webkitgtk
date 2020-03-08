# DEPRECATED

At the moment, probably a better idea is to use playwright.

It supports lots of browser engines, among them are webkit gtk and wpe ports.

I plan to write a module that emits the "idle" event, which is the only really novelty here.


node-webkitgtk
==============

Pilot webkitgtk from Node.js with a simple API.

Also offers a command-line REPL, able to display (or not) the
current window, output pdf or png, see `webkitgtk --help`,
and several example calls in examples/repl.sh.

Falls back to jsdom if the module cannot be compiled (with obvious
limitations like inability to render the DOM nor output png or pdf).

Typically, [express-dom](https://github.com/kapouer/express-dom) can run
on webkitgtk's jsdom mode - developers can work on other platforms where
jsdom builds fine.

*this module uses only system-installed, shared libraries*  
it doesn't embed static libraries, meaning it plugs very nicely into
system-installed libraries.


Node.js compatibility
---------------------

Node.js LTS and Current.


usage
-----

The API has two styles:
- with callbacks, all methods return current instance
- without callbacks, all methods return promise

For convenience, the returned promises have bound methods once, on, when.


These calls will output pdf/png version of fully loaded pages (see documentation
below about idle event).

Pdf output from cli:

```
webkitgtk --pdf test.pdf \
	--paper 210x297 \
	--margins 20,20,20,20 \
	--unit mm \
	http://google.fr
```

Png output from cli:

```
webkitgtk --png test.png http://nasa.gov
```


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
view.init(displayOpts).then(function() {
  view.load(uri, {
    style: fs.readFileSync('css/png.css') // useful stylesheet for snapshots
  })
  view.when('load', function() {
    return this.png('test.png');
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
.when("idle", function() {
  // promise variant
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

- WebKitSettings  
  http://webkitgtk.org/reference/webkit2gtk/stable/WebKitSettings.html  
  Some settings have different default values:  
  enable-plugins: FALSE  
  enable-html5-database: FALSE  
  enable-html5-local-storage: FALSE  
  enable-java: FALSE  
  enable-page-cache: FALSE  
  enable-offline-web-application-cache: FALSE  
  default-charset: "utf-8"  
  user-agent: backend-specific value  

- deprecated WebKitSettings aliases:  
  private: enable-private-browsing  
  images: auto-load-images  
  localAccess: allow-file-access-from-file-urls  
  ua: user-agent  
  charset: default-charset  

- cookies  
  string | [string], default none  
  note that as of webkitgtk 4.3.3 cookies are properly cleared and isolated between views.

- width  
  number, 1024
- height  
  number, 768  
  the viewport

- allow  
  "all" or "same-origin" or "none" or a RegExp, default "all"  
  A short-hand filter that is run after all other filters.  
  Note that data:uri are discarded by "none" and allowed by "same-origin".

- filters  
  An array of request filters that are run in browser, synchronously.  
  All filters are called one after another, and each filter can read-write the
  following properties on `this`:  
   uri (string)  
   cancel (boolean)  
   ignore (boolean)  
  and has read-only access to  
   from (string, in case the uri was redirected from another uri)  
  In particular, a filter can revert the action of a previous filter.  
  The initial document loading request is not filtered.  
  A single filter is either a `function() {}`,
  or an array `[function(arg0, ...) {}, arg0, ...]`, allowing passing
  immutable stringyfiable arguments to the filter function.

- filter  
  Convenient option to append one filter to the list in opts.filters.

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
  buffer, string or {fn: function(..args) {}, args: [..]}, default null  
  insert script at the beginning of loaded document.  
  args length must match fn function arity.

- scripts  
  same as script but an array of them, default []

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

- timeout  
  number, default 30000  
  timeout for load(), in milliseconds

- stall  
  number, default 1000  
  requests not receiving data for `stall` milliseconds are not taken into
  account for deciding `idle` events.

- stallInterval  
  number, default 1000  
  wait that long before ignoring all setInterval tasks as idle condition.  
  Set to 0 to ignore all.

- stallTimeout  
  number, default 100  
  wait that long before ignoring all setTimeout tasks with timeout > 0 as
  idle condition. Tasks with 0 timeout will not be ignored, though.  
  Set to 0 to ignore all.

- stallFrame  
  number, default 1000  
  wait that long before ignoring requestAnimationFrames as idle condition.  
  Set to 0 to ignore all.

- console  
  boolean, default false  
  Send `console` events (see below).  
  Default listener outputs everything and is disabled by registering a custom
  listener.

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

- offscreen  
  boolean, default true  
  By default, nothing is shown on display. Set to false to display a window.

- resizing  
  boolean, default false  
  Set to true to allow window.moveTo/resizeTo (and moveBy/resizeBy) to be
  handed over to the window manager (which might ignore the requests).  
  (New in version 4.8.0)

- verbose  
  boolean, default false  
  log client errors and stalled requests, otherwise available as
  DEBUG=webkitgtk:timeout,webkitgtk:error.

- cacheDir  
  string, $user_cache_dir/node-webkitgtk  
  path to webkitgtk cache directory.  
  Changing cacheDir can fail silently if webkitgtk lib is already initialized.

- cacheModel  
  string, defaults to browser.  
  none: disables cache completely  
  local: cache optimized for viewing local files  
  browser: the real deal  

- debug  
  boolean, default false  
  shows a real window with a web inspector.  
  As a commodity, *the inspector must be closed* to get the `idle` event fired.

- cookiePolicy  
  string, "always", "never", any other string defaults to "no third party".

If width, height, depth options are given, an xvfb instance listening
given display port will be spawned using `headless` module.
Wrapping the application with `xvfb-run` command line tool is a safe(r) alternative.


pdf() options
-------------

If you plan to author html pages for printing, i strongly suggest to set
an html document width in pixels equal to the paper width at 144 dpi (example:
1190px for iso_a4 portrait).
Also never forget that 1in = 2.54cm = 25.4mm = 72pt = 6pc. See
https://www.w3.org/Style/Examples/007/units.html

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
  sets all margins in "pt" units, default 0

- margins (string)  
  sets all margins in given units, default 0 and "pt"

- margins (object)  
  unit : string, mm|in|pt, default "pt"  
  left, top, right, bottom : number, default 0


events
------

All events are on the WebKit instance.

These are lifecycle events:

* ready  
  same as document's DOMContentLoaded event  

* load  
  same as window's load event  

* idle  
  when all requests (xhr included), timeouts, intervals, animation requests,
  are finished or timed out (see stall* options).  

* unload  
  same as window's unload event  

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

* data  
  listener(res), called as soon as the first chunk of data is received.  
  res have read-only properties uri, mime, status, length, filename, headers,  
  and clength - the length of the received chunk of data.  

* authenticate  
  listener(request) where request.host, request.port, request.realm are
  read-only.  
  request.use(username, password) authenticates  
  request.ignore() ignores authentication  
  Both methods can be called later (asynchronously), but at least one of them
  is supposed to be called if the signal is handled.

* navigate  
  listener(url)  
  Called when document location changes (not when history state change).  
  Navigation is permitted or not using `navigation` option, not this event.

* console (deprecated)  
  listener(level, ...) where level is 'log', 'error', 'warn' or 'info'.  
  Remaining arguments are the arguments of the corresponding calls to
  console[level] inside the page.  
  Logging everything that comes out of web pages can be annoying, so this is
  disabled by default.  
  This event is deprecated - use `console` load option to enable/disable
  console output instead.

* crash (since version 4.9.0)  
  When the underlying web view has crashed.  
  It's a good idea to destroy it and use a new one.

methods
-------

* new Webkit()  
  creates an unitialized instance upon which init() must be called.  
  WebKit is also an EventEmitter.

* WebKit(opts?, cb)  
  Same as above.  
  If arguments are given, equals `new WebKit().init(opts, cb)`.

* init(opts?, cb)  
  see parameters described above  
  *must be invoked before (pre)load*.  
  Callback receives (err, instance).

* clearCache()  
  Clear cache of the current instance.  
  Busy on-disk resources won't be cleared, so it's safer to call on an unloaded view.
  Other running instances sharing the same cache may not be immediately affected.

* preload(uri, opts?, cb)  
  load uri into webview  
  initial scripts are not run, resources are not loaded.  
  These options are not effective: `cookies`, `script`, `allow`.  
  Callback receives (err, instance).

* load(uri, opts?, cb)  
  load uri into webview  
  see parameters described above.  
  Callback receives (err, instance).

* once(event, listener)  
  the standard synchronous EventEmitter interface

* when(event, asyncListener*)  
  Allow queuing asynchronous jobs on an event and before next event.  
  The async listener can have a function length of zero, in which case
  it is considered to be a thenable; and the method returns the promise.  
  If asyncListener is missing it returns the latest promise.  
  Using promises is the only way to catch errors from previous jobs.  
  Otherwise the callback-style API is assumed.  

* run(sync-script, param*, cb)  
  any synchronous script text or global function.  
  If it's a function, multiple parameters can be passed, as long as they are
  serializable.

* run(async-script, param*, cb)  
  async-script must be a function with callback as last argument,
  whose arguments will be passed to cb, as long as they are stringifyable.

* runev(async-script, param*, cb)  
  async-script must be a function, it receives an `emit` function as last
  argument, which in turn acts as event emitter: each call emits the named event
  on current instance, and can be listened using view.on(event, listener).  
  The listener receives additional arguments as long as they're stringifyable.  
  Can be used to listen recurring events.

* png(writableStream or filename, cb)  
  takes a png snapshot of the whole document right now.  
  If invoked with a filename, save the stream to file.  
  Tip: use custom css to cut portions of the document.

* html(cb)  
  get the whole document html, prepended with its doctype, right now.  
  Callback receives (err, str).

* pdf(filepath, opts?, cb)  
  print page to file right now  
  see parameters described above.

* reset(cb)  
  Stops loading if it was, unregister listeners, allows .load() to be run
  sooner than when calling unload.

* unload(cb)  
  Sets current view to an empty document and uri.  
  Emits 'unload' event.

* destroy(cb)  
  does the reverse of init - frees webview and xvfb instance if any.  
  init() can be called again to recover a working instance.  
  destroy must be called after unload to avoid memory leaks.


properties
----------

* WebKit.navigator  
  static property, a copy of the currently installed engine.

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

Compatible with webkitgtk (WebKit2) versions 2.8 and above.

It's usually a better idea to use latest stable webkit2gtk.

These libraries and their development files must be available in usual
locations.

```
webkit2gtk-3.0 (2.4.x), for node-webkitgtk 1.2.x
webkit2gtk-4.0 (>= 2.8.x), for node-webkitgtk >= 1.3.0
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
libwebkit2gtk-4.0-dev (>= 2.8.x), for node-webkitgtk >= 1.3.0
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


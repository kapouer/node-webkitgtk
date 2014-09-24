node-webkitgtk
==============

Pilot webkitgtk from Node.js with a simple API.


usage
-----

The chainable API (requires `chainit`)

```js
WebKit().load('http://github.com')
  .png('github.png')
  .pdf('github.pdf')
  .html(function(err, html) {
    // the html body as string
    console.log(this.status, html);
  }).on('authenticate', function(auth) {
    auth.use('mylogin', 'mypass');
  }).on('request', function(req) {
    if (/\.js/.test(req.uri)) req.uri = null;
  }).on('response', function(res) {
    console.log(res.status, res.uri);
  });
```


Or the basic one from which the chainable API is build

```js
var WebKit = require('webkitgtk');
var view = new WebKit();
view.init({
	width: 1024,
	height: 768,
	display: "99"
}, function(err, view) {
	view.load(uri, {
		stylesheet: "css/png.css"
	}, function(err) {
		if (err) console.error(err);
	}).on('load', function() {
		this.png().save('test.png', function(err) {
			if (err) console.error(err);
			else console.log("screenshot saved", uri);
		});
	});
});
```

A facility for choosing/spawning a display using xvfb

```js
// this spawns xvfb instance
WebKit("1024x768x16:99").load("http://github.com").png('test.png');

// this uses a pre-existing display
WebKit(98).load("http://google.com")

// use pre-existing display 0 by default
Webkit().load("http://webkitgtk.org").html(function(err, html) {
	// dump html
	console.log(html);
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


load() options
--------------

- cookies  
  string | [string], default none  
  it preloads the document to be able to set document.cookie, all other
  requests being disabled, then do the actual load with Cookie header.

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

- navigation  
  boolean, default false  
  allow navigation within the webview (changing document.location).

- dialogs  
  boolean, default false  
  allow display of dialogs.

- content  
  string, default null  
  load this content with the given base uri

- css  
  string, default none  
  a css string applied as user stylesheet.

- stylesheet  
  string, default none  
  path to some user stylesheet, overrides css option if any.

- ua  
  user-agent string, default to "Mozilla/5.0"


init() options
--------------

- display  
  number, 0  
  checks an X display or framebuffer is listening on that port

- width  
  number, 1024
- height  
  number, 768
  Framebuffer dimensions
- depth  
  number, 32
  Framebuffer pixel depth

- WIDTHxHEIGHTxDEPTH:PORT  
  string, null  
  a short-hand notation for passing all these options at once.

If width, height, depth options are given, an xvfb instance listening
given display port will be spawn using `headless` module.

It is advised and safer to monitor xvfb using a proper daemon tool.


events
------

All events are on the WebKit instance.

The first four events are like lifecycle events:

* ready  
  same as document's DOMContentLoaded event  
  listener()

* load  
  same as window's load event  
  listener()

* idle  
  when all requests are finished, failed, or just hanging, and when the
  gtk loop has been doing nothing for a couple of cycles.  
  This event is used to automatically pause the view.  
  Use .on('idle', function() { this.loop(true); }) to restart the gtk
  loop if needed.

* unload  
  same as window's unload event  
  listener()


These three events can happen at any moment:

* error  
  this is what is caught by window.onerror  
  listener(message, url, line, column)

* request  
  listener(request) where request.uri is read/write.  
  If request.uri is set to null or "", the request is cancelled.

* response  
  listener(response)  
  response.uri, response.mime, response.status are read-only.  
  response.data(function(err, buf)) fetches the response data.

* authenticate  
  listener(request) where request.host, request.port, request.realm are
  read-only.  
  request.use(username, password) authenticates asynchronously,  
  request.ignore() ignores request asynchronously.


methods
-------

* new Webkit()  
  creates a totally unusable object

* WebKit([opts])  
  create an instance with the chainable API using `chainit`.  
  If arguments are given, equals `WebKit().init(opts)`

* init([opts], cb)  
  see parameters described above  
  *must be invoked first*

* load(uri, [opts], [cb])  
  load uri into webview  
  see parameters described above

* run(sync-script, cb)  
  any synchronous script text or global function

* run(async-script, cb)  
  async-script must be a function that calls its first and only argument,  
  like `function(done) { done(err, str); }`

* runev(async-script, cb)  
  async-script must be a function that calls its first and only argument,  
  like `function(emit) { emit(eventName); }`  
  and each call emits the named event on current view object, which can
  be listened using view.on(event, listener).  
  Can be used to listen recurring events, but the gtk loop needs to be
  running, see above.  
  The cb argument is only there for the chaining API to work, it reports
  only arguments errors - it can be omitted if the chainable API isn't used.

* png(writableStream or filename, [cb])  
  takes a png snapshot immediately, returns a stream.  
  If invoked with a filename, save the stream to file.

* html(cb)  
  get documentElement.outerHTML when document is ready

* pdf(filepath, [opts], [cb])  
  print page to file  
  orientation : "landscape" or "portrait", default "portrait"  
  fullpage : boolean, sets margins to 0, default false

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
  Before the first call to .load() it is empty, and before the callback
  it is opening.


gtk loop and events
-------------------

webkit cannot run if its gtk event loop isn't run, and running the gtk
loop is done by calling gtk_main_iteration_do on each Node.js process
event loop. It works all right, but as long as setImmediate is called,
the current node process won't stop either.

To allow the gtk loop to stop when running it is no longer useful,
webkitgtk starts running the gtk loop when these methods are called:

* load
* run but not the run(fun, event) signature
* pdf
* png
* html

and it stops running the gtk loop when these conditions are met:

* when a lifecycle event happen and the next lifecycle event has no
  listener
* when all callbacks have been invoked and the next lifecycle event
  has no listener

For example, if there are no "idle" listeners after "load" is emitted,
the loop won't be kept running.

Note that calling run(fun, event) won't start the gtk loop, and receiving
such events won't stop the gtk loop either.

To keep the gtk loop running forever, just listen to "unload" event.


about plugins
-------------

In webkit2gtk ^2.4.4, if there are plugins in `/usr/lib/mozilla/plugins`
they could be loaded (but not necessarily enabled on the WebView),
and that could impact first page load time greatly - especially if
there's a java plugin.

Workaround:
uninstall the plugin, on my dev machine it was
/usr/lib/mozilla/plugins/libjavaplugin.so installed by icedtea.


install
-------

Linux only.

These libraries and their development files must be available in usual
locations.

webkit2gtk-3.0 (2.4.x)
dbus-glib-1
glib-2.0
gtk+-3.0

Also usual development tools are needed (pkg-config, gcc, and so on).

On debian, these packages are needed :

libwebkit2gtk-3.0-dev
libdbus-glib-1-dev

License
-------

MIT, see LICENSE file


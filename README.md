node-webkitgtk
==============

Pilot webkitgtk from Node.js with a simple API.

*DEVELOPMENT VERSION*


usage
-----

```
var WebKit = require('webkitgtk');
WebKit(uri, {
	width: 1024,
	height: 768,
	stylesheet: "css/png.css"
}, function(err, view) {
  // optional callback
}).on('load', function() {
  this.png().save('test.png', function(err) {
	  // file saved
	});
});
```

See test/ for more examples.

WebKit is a class whose instances are views.
`var view = new Webkit()` is the same as `var view = Webkit()`.

`Webkit(uri, [opts], [cb])` is a short-hand for `Webkit().load(uri, opts, cb)`.


options
-------

- username
- password
  string, default none
  HTTP Auth.

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

- dialogs
  boolean, default false
	allow display of dialogs.

- css
	string, default none
	a css string applied as user stylesheet.

- stylesheet
	string, default none
	path to some user stylesheet, overrides css option if any.

- display
	number, default 0
	the X display needed by gtk X11 backend

- xfb
	{width: 1024, height: 768, depth: 32}, default false
	spawn a X backend with these options with number given by 'display',
	or any higher number available.
	Requires "headless" module.
	It is safer to use a daemon monitoring tool for xvfb and just
	set display option.


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

* unload TODO with the ability to prevent unloading
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


gtk loop and events
-------------------

Calls to webkitgtk (load, run, png, pdf) all make the gtk loop run.
When the gtk loop is stopped, all processing is suspended within
webkitgtk - network, rendering, events...

To allow the gtk loop to stop when running it is no longer useful,
webkitgtk.js stops it if the next lifecycle event has no listeners.

For example, if there are no "idle" listeners after "load" is emitted,
the loop won't be kept running.

To keep the gtk loop running forever, just listen to "unload" event,
or manually restart it using internal method .loop(true).


methods
-------

* [new] Webkit([opts], [cb])
  if opts.display is set it will check that display is available.

* [new] WebKit(uri, [opts], [cb])
	initialize display then calls .load(uri, opts, cb)

* load(uri, [opts], [cb])
  load uri - can be called right after WebKit instantiation, the
	display initializing will always be done before.
	This method cannot be called twice in a row !

* run(sync-script, cb)
  any synchronous script text or global function

* run(async-script, cb)
  async-script must be a function that calls its first and only argument,
	like `function(done) { done(err, str); }`

* run(async-script, event)
	async-script must be a function that calls its first and only argument,
	and each call emits the named event on current view object, which can
	be listened using view.on(event, listener)
	Can be used to listen recurring events, but the gtk loop needs to be
	running, see above.

* png()
  takes a png snapshot immediately, returns a stream with an additional
	.save(filename) short-hand for saving to a file

* html(cb)
  get documentElement.outerHTML when document is ready

* pdf(filepath, [opts], [cb])
  print page to file
	orientation : "landscape" or "portrait", default "portrait"
	fullpage : boolean, sets margins to 0, default false

* unload
  like `load('about:blank')`, can be used to clear the WebView and
	load something later

* close
	that one really makes the object unusable and frees memory


properties
----------

* uri
  Read-only, get current uri of the web view.


about plugins
-------------

In webkit2gtk ^2.4.4, if there are plugins in
/usr/lib/mozilla/plugins
they could be loaded (but not necessarily enabled on the WebView),
and that could impact first page load time greatly - especially if
there's a java plugin.
Workaround: uninstall the plugin, on my dev machine it was
/usr/lib/mozilla/plugins/libjavaplugin.so installed by icedtea.


use cases
---------

This module is specifically designed to run 'headless'.
Patches are welcome for UI uses, though.

* snapshotting service (in combination with 'gm' module)

* print to pdf service (in combination with 'gs' module)

* static web page rendering

* long-running web page as a service with websockets or webrtc
  communications


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


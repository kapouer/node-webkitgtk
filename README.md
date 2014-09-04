node-webkitgtk
==============

Pilot webkitgtk from Node.js with a simple API.


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
}).on('load', function(view) {
  view.png().save('test.png', function(err) {
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

username: 'login',
password: 'pass',
cookie: "name=value;", // TODO
width: 1024,
height: 768,
images: false,
scripts: false || 'sameOrigin' || true // TODO
dialogs: false,
css: "html,body {overflow:hidden;}"
stylesheet: "/path/to/stylesheet.css" // overrides css
window: false // use offscreen - still requires X display though TODO
xdisplay: ":0" // set DISPLAY=":0" env TODO
xvfb: false // spawn Xvfb on given xdisplay DISPLAY TODO

events
------

All events are on the WebKit instance.

* ready
  same as document's DOMContentLoaded event
	listener(view)

* load
  same as window's load event
	listener(view)

* steady
  when there are no pending requests that have been initiated after
	load event TODO

* request
  listener(request, view) where request.uri is read/write.
	If request.uri is set to null, the request is cancelled.

* response
  listener(response, view)
	response.uri, response.mime, response.status are read-only.
	response.data(function(err, buf)) fetches the response data.

Due to some restrictions in the way webkit works with policy decisions
and resource data fetching, it is impossible to merge 'response' and
'decide' events into a single 'response' event.


methods
-------

* load(uri, [opts], [cb])

* run(sync-script, cb)
  any synchronous script text or global function

* run(async-script, cb)
  async-script must be a function that call its first and only argument,
	like `function(done) { done(err, str); }`

* run(path, cb) TODO
  path to a javascript file

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
  like `load('about:blank')`


about plugins
-------------

In webkit2gtk ^2.4.4, if there are plugins in
/usr/lib/mozilla/plugins
they could be loaded (but not necessarily enabled on the WebView),
and that could impact first page load time greatly - especially if
there's a java plugin.
Workaround: uninstall the plugin, on my dev machine it was
/usr/lib/mozilla/plugins/libjavaplugin.so installed by icedtea.


cookie TODO
-----------

Setting the HTTP Cookie header before doing a page request is not
possible with WebKit2.

* It is however possible to set custom headers like X-Cookie.
  It's then up to the server to deal with those custom headers.

* Or a proxy could replace an X-Cookie with Cookie - but doing this
  is probabaly bound to fail with too many side effects.

* webkit_dom_document_set_cookie(document, "a=b", &err);
  works but somehow only with constant strings

* to try: set_uri(myuri) but prevent all resources to be loaded
  then run js document.cookie = "mycookie=test"
  then from the same view, reload page and let loading happen as usual.


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

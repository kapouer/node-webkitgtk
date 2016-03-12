var hasNative;
var useJSDOM = !!process.env.USE_JSDOM;
if (!useJSDOM) {
	try {
		hasNative = require.resolve(__dirname + '/lib/webkitgtk.node');
	} catch(e) {}
}
var WebKit = require('./src/webkitgtk');
if (!hasNative) {
	var jsdom = require('jsdom');
	if (!useJSDOM) {
		console.info('No webkitgtk bindings available, trying with jsdom...');
	}
	if (!jsdom) {
		console.info('jsdom is missing, please install it.\nExiting');
		process.exit(1);
	}
	require('./jsdom')(WebKit);
}

module.exports = WebKit;


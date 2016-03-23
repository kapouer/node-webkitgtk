var WebKit = require('../');
var expect = require('expect.js');
var fs = require('fs');

describe("console events", function suite() {
	it("should be received", function(done) {
		WebKit.load('http://localhost', {
			content:  `<html><body><script type="text/javascript">
				console.log(window.navigator.appName, "two");
			</script></body></html>`,
			console: true
		}).on('console', function(level, appName, two) {
			expect(level).to.be('log');
			expect(appName).to.be('Netscape');
			expect(two).to.be('two');
			done();
		});
	});
	it("should not receive unserializable arguments", function(done) {
		WebKit.load('http://localhost', {
			content: '<html><body><script type="text/javascript">console.log(window, "two");</script></body></html>',
			console: true
		}).on('console', function(level, nav, two) {
			expect(level).to.be('log');
			expect(nav).to.be(null);
			expect(two).to.be('two');
			done();
		});
	});
});

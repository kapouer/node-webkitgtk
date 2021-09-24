const WebKit = require('../');
const expect = require('expect.js');

describe("console events", () => {
	it("should be received", (done) => {
		WebKit.load('http://localhost', {
			content:  `<html><body><script type="text/javascript">
				console.log(window.navigator.appName, "two");
			</script></body></html>`,
			console: true
		}).on('console', (level, appName, two) => {
			expect(level).to.be('log');
			expect(appName).to.be('Netscape');
			expect(two).to.be('two');
			done();
		});
	});
	it("should not receive unserializable arguments", (done) => {
		WebKit.load('http://localhost', {
			content: '<html><body><script type="text/javascript">console.log(window, "two");</script></body></html>',
			console: true
		}).on('console', (level, nav, two) => {
			expect(level).to.be('log');
			expect(nav).to.be(null);
			expect(two).to.be('two');
			done();
		});
	});
});

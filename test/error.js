const WebKit = require('../');
const expect = require('expect.js');

describe("error reporting", () => {
	it("should catch async script errors", function(done) {
		this.timeout(1000);
		const w = WebKit.load("http://localhost", {content: '<html></html>'}, (err) => {
			w.run((done) => {
				setTimeout(() => {
					// eslint-disable-next-line no-undef, no-unused-vars
					const r = 2 + h;
					done(); // won't actually be called
				}, 100);
			}, (err) => {
				expect(err).to.be.ok(); // timeout
			});
			w.on('error', (msg, uri, line, col, err) => {
				expect(msg).to.be('ReferenceError: Can\'t find variable: h');
				done();
			});
		});
	});
	it("should catch sync script errors", function(done) {
		this.timeout(1000);
		const w = WebKit.load("http://localhost", {content: '<html></html>'}, (err) => {
			w.run(() => {
				document.createWhatever("tata");
			}, (err) => {
				expect(err && err.stack).to.be.ok();
				done();
			});
		});
	});
	it("should log uncaught Error instances with actual exception stack", function(done) {
		this.timeout(1000);
		WebKit((err, w) => {
			w.load("http://localhost", {content: '<html></html>'}, (err) => {
				w.run((done) => {
					setTimeout(() => {
						const err = new SyntaxError("i am here");
						err.code = 404;
						throw err;
						// eslint-disable-next-line no-unreachable
						done(); // won't actually be called
					}, 100);
				}, (err) => {
					expect(err).to.be.ok(); // timeout
				});
			});
			w.on('error', (msg, uri, line, col, err) => {
				expect(err).to.be.ok();
				expect(err.message).to.be("i am here");
				expect(err.code).to.be(404);
				expect(err.name).to.be("SyntaxError");
				expect(err instanceof SyntaxError).to.be.ok();
				expect(err.stack).to.be.ok();
				done();
			});
		});
	});
});

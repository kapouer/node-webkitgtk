const WebKit = require('../');
const expect = require('expect.js');

describe("unload method", () => {
	it("should be set to an empty url", (done) => {
		WebKit((err, w) => {
			w.unload((err) => {
				expect(err).to.not.be.ok();
				expect(w.uri).to.be("");
				done();
			});
		});
	});

	it("should allow chaining load-unload-load", function(done) {
		this.timeout(10000);
		WebKit.load('http://google.com', {'auto-load-images': false}, (err, w) => {
			w.unload((err) => {
				expect(err).to.not.be.ok();
				w.load('http://www.selmer.fr', {'auto-load-images': false}, (err) => {
					expect(err).to.not.be.ok();
					done();
				});
			});
		});
	});

	it("should allow chaining load-reset-load", function(done) {
		this.timeout(10000);
		WebKit.load('http://google.com', {'auto-load-images': false}, (err, w) => {
			w.reset((err) => {
				expect(err).to.not.be.ok();
				w.load('http://www.selmer.fr', {'auto-load-images': false}, (err) => {
					expect(err).to.not.be.ok();
					done();
				});
			});
		});
	});

	it("should not need to remove listeners after unload", function(done) {
		this.timeout(10000);
		const v = new WebKit();
		v.init((err) => {
			v.load('http://google.com', {allow: "none"});
			v.once('ready', () => {
				v.unload((err) => {
					v.load('http://github.com', {allow:"none"});
					v.once('ready', () => {
						done();
					});
				});
			});
		});
	});

	it("should allow chaining load-unload-load with content", function(done) {
		this.timeout(2000);
		WebKit.load('http://google.com', {content: '<html><body>pisderman</body></html>'}, (err, w) => {
			w.unload((err) => {
				expect(err).to.not.be.ok();
				w.load('http://www.selmer.fr', {content: '<html><body>volapuk</body></html>'}, (err) => {
					expect(err).to.not.be.ok();
					done();
				});
			});
		});
	});

	it("should be ok with unload after a while", function(done) {
		this.timeout(10000);
		WebKit.load('http://google.com').once('idle', function() {
			setTimeout(() => {
				this.unload((err) => {
					expect(err).to.not.be.ok();
					setTimeout(done, 1000);
				});
			}, 3000);
		});
	});
});

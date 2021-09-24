const WebKit = require('../');
const expect = require('expect.js');

describe("cookies option", () => {
	let port, server;
	let countOne = 0;
	const cookiestrOne = "mycookie=myvalue";
	let countTwo = 0;
	const cookiestrTwo = "mycookie=myvalue2";
	let hadXhr = false;
	let hadScript = false;

	before((done) => {
		server = require('http').createServer((req, res) => {
			if (req.url == "/test/xhr/json") {
				expect(req.headers.cookie).to.be(cookiestrOne);
				hadXhr = true;
				res.setHeader('Content-Type', 'application/json');
				res.write('{"data": "stuff"}');
			} else if (req.url == "/test/xhr") {
				res.write('<html><head><script type="text/javascript">\
				var xhr = new XMLHttpRequest(); \
				xhr.open("get", "/test/xhr/json", true);\
				xhr.send();\
				</script></head><body>test</body></html>');
			} else if (req.url == "/test/one") {
				if (countOne == 0) expect(req.headers.cookie).to.be(cookiestrOne);
				countOne++;
				res.write('<html><body><img src="myimg.png"/></body></html>');
			} else if (req.url == "/test/two") {
				if (countTwo == 0) expect(req.headers.cookie).to.be(cookiestrOne);
				if (countTwo == 1) expect(req.headers.cookie).to.be(cookiestrTwo);
				countTwo++;
				res.write('<html><body><img src="myimg.png"/></body></html>');
			} else if (req.url == "/test/content/script.js") {
				hadScript = true;
				res.write('document.body.innerHTML = "some thing";');
			} else {
				res.writeHeader(404);
			}
			res.end();
		}).listen(() => {
			port = server.address().port;
			done();
		});
	});
	after((done) => {
		server.close();
		done();
	});

	it("should set Cookie HTTP header on first request", (done) => {
		WebKit.load("http://localhost:" + port + "/test/one", {cookies:cookiestrOne + "; Path=/test/one"}, (err, w) => {
			expect(err).to.not.be.ok();
			expect(countOne).to.be(1);
			done();
		});
	});

	it("should set a different Cookie HTTP header on a subsequent load", (done) => {
		WebKit.load("http://localhost:" + port + "/test/two", {cookies:cookiestrOne + "; Path=/test/two"}, (err, w) => {
			expect(err).to.not.be.ok();
			expect(countTwo).to.be(1);
			w.unload(() => {
				w.load("http://localhost:" + port + "/test/two", {cookies:cookiestrTwo + "; Path=/test/two"}, (err) => {
					expect(err).to.not.be.ok();
					expect(countTwo).to.be(2);
					done();
				});
			});
		});
	});

	it("should set Cookie HTTP header on xhr request", (done) => {
		WebKit.load("http://localhost:" + port + "/test/xhr", {cookies:cookiestrOne + "; Path=/test/xhr"})
			.once('idle', () => {
				expect(hadXhr).to.be(true);
				done();
			});
	});

	it("should support without glitch preload content then load content with cookie", (done) => {
		const content = '<html><script type="text/javascript" src="/test/content/script.js"></script><head></head><body></body></html>';
		const w = new WebKit();
		w.init(() => {
			w.preload("http://localhost:" + port + "/test/content", {content: content, allow: "none"}).once('idle', function() {
				this.unload(next);
			});
		});

		function next() {
			w.load("http://localhost:" + port + "/test/content", {
				content: content,
				cookies:cookiestrOne + "; Path=/test/content"
			}).once('idle', () => {
				expect(hadScript).to.be(true);
				done();
			});
		}
	});

	it("should set same cookie in two views and not interfere", () => {
		return Promise.all([WebKit.load('http://localhost/test', {
			content: '<html><body>A</body></html>'
		}), WebKit.load('http://localhost/test', {
			content: '<html><body>B</body></html>'
		})]).then((all) => {
			const ia = all[0];
			const ib = all[1];
			return ia.run(() => {
				document.cookie = "cn=1234";
			}).then(() => {
				return ib.run((done) => {
					done(null, document.cookie);
					document.cookie = "cn=4567";
				});
			}).then((cookie) => {
				expect(cookie).to.not.be.ok();
				return ia.run((done) => {
					done(null, document.cookie);
					document.cookie = "cn=12345";
				});
			}).then((cookie) => {
				expect(cookie).to.be("cn=1234");
				return ib.run((done) => {
					done(null, document.cookie);
				});
			}).then((cookie) => {
				expect(cookie).to.be("cn=4567");
				return ia.run((done) => {
					done(null, document.cookie);
				});
			}).then((cookie) => {
				expect(cookie).to.be("cn=12345");
			});
		});
	});
	it("should clear cookies when setting them on a view", () => {
		return WebKit.load('http://localhost/test', {
			content: '<html><body>A</body></html>',
			cookies: 'cn=one'
		}).then((view) => {
			return view.run((done) => {
				done(null, document.cookie);
			}).then((cookie) => {
				expect(cookie).to.be("cn=one");
				return view.load('http://localhost/test', {
					content: '<html><body>A</body></html>',
					cookies: 'cp=two'
				}).then(() => {
					return view.run((done) => {
						done(null, document.cookie);
					});
				});
			}).then((cookie) => {
				expect(cookie).to.be("cp=two");
				return view.load('http://localhost/test', {
					content: '<html><body>A</body></html>'
				}).then(() => {
					return view.run((done) => {
						done(null, document.cookie);
					});
				}).then((cookie) => {
					expect(cookie).to.not.be.ok();
				});
			});
		});
	});
	it("should clear cookies even from a subpath", () => {
		return WebKit.load('http://localhost/test', {
			content: '<html><body>A</body></html>',
			cookies: 'cn=one'
		}).then((view) => {
			return view.run((done) => {
				done(null, document.cookie);
			}).then((cookie) => {
				expect(cookie).to.be("cn=one");
				return view.load('http://localhost/test/two', {
					content: '<html><body>A</body></html>',
					cookies: 'cp=two'
				}).then(() => {
					return view.run((done) => {
						done(null, document.cookie);
					});
				});
			}).then((cookie) => {
				expect(cookie).to.be("cp=two");
			});
		});
	});
});


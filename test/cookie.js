var WebKit = require('../');
var expect = require('expect.js');
var fs = require('fs');


describe("cookies option", function suite() {
	var port, server;
	var countOne = 0;
	var cookiestrOne = "mycookie=myvalue";
	var countTwo = 0;
	var cookiestrTwo = "mycookie=myvalue2";
	var hadXhr = false;
	var hadScript = false;

	before(function(done) {
		server = require('http').createServer(function(req, res) {
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
		}).listen(function() {
			port = server.address().port;
			done();
		});
	});
	after(function(done) {
		server.close();
		done();
	});

	it("should set Cookie HTTP header on first request", function(done) {
		WebKit.load("http://localhost:" + port + "/test/one", {cookies:cookiestrOne + "; Path=/test/one"}, function(err, w) {
			expect(err).to.not.be.ok();
			expect(countOne).to.be(1);
			done();
		});
	});

	it("should set a different Cookie HTTP header on a subsequent load", function(done) {
		var count = 0;
		var cookiestr = "mycookie=myvalue";
		var cookiestr2 = "mycookie=myvalue2";

		WebKit.load("http://localhost:" + port + "/test/two", {cookies:cookiestrOne + "; Path=/test/two"}, function(err, w) {
			expect(err).to.not.be.ok();
			expect(countTwo).to.be(1);
			w.unload(function() {
				w.load("http://localhost:" + port + "/test/two", {cookies:cookiestrTwo + "; Path=/test/two"}, function(err) {
					expect(err).to.not.be.ok();
					expect(countTwo).to.be(2);
					done();
				});
			});
		});
	});

	it("should set Cookie HTTP header on xhr request", function(done) {
		WebKit.load("http://localhost:" + port + "/test/xhr", {cookies:cookiestrOne + "; Path=/test/xhr"})
		.once('idle', function() {
			expect(hadXhr).to.be(true);
			done();
		});
	});

	it("should support without glitch preload content then load content with cookie", function(done) {
		var content = '<html><script type="text/javascript" src="/test/content/script.js"></script><head></head><body></body></html>';
		var w = new WebKit();
		w.init(function() {
			w.preload("http://localhost:" + port + "/test/content", {content: content, allow: "none"}).once('idle', function() {
				this.unload(next);
			});
		});

		function next() {
			w.load("http://localhost:" + port + "/test/content", {
				content: content,
				cookies:cookiestrOne + "; Path=/test/content"
			}).once('idle', function() {
				expect(hadScript).to.be(true);
				done();
			});
		}
	});

	it("should set same cookie in two views and not interfere", function() {
		return Promise.all([WebKit.load('http://localhost/test', {
			content: '<html><body>A</body></html>'
		}), WebKit.load('http://localhost/test', {
			content: '<html><body>B</body></html>'
		})]).then(function(all) {
			var ia = all[0];
			var ib = all[1];
			return ia.run(function() {
				document.cookie = "cn=1234";
			}).then(function() {
				return ib.run(function(done) {
					done(null, document.cookie);
					document.cookie = "cn=4567";
				});
			}).then(function(cookie) {
				expect(cookie).to.not.be.ok();
				return ia.run(function(done) {
					done(null, document.cookie);
					document.cookie = "cn=12345";
				});
			}).then(function(cookie) {
				expect(cookie).to.be("cn=1234");
				return ib.run(function(done) {
					done(null, document.cookie);
				});
			}).then(function(cookie) {
				expect(cookie).to.be("cn=4567");
				return ia.run(function(done) {
					done(null, document.cookie);
				});
			}).then(function(cookie) {
				expect(cookie).to.be("cn=12345");
			});
		});
	});
	it("should clear cookies when setting them on a view", function() {
		return WebKit.load('http://localhost/test', {
			content: '<html><body>A</body></html>',
			cookies: 'cn=one'
		}).then(function(view) {
			return view.run(function(done) {
				done(null, document.cookie);
			}).then(function(cookie) {
				expect(cookie).to.be("cn=one");
				return view.load('http://localhost/test', {
					content: '<html><body>A</body></html>',
					cookies: 'cp=two'
				}).then(function() {
					return view.run(function(done) {
						done(null, document.cookie);
					});
				});
			}).then(function(cookie) {
				expect(cookie).to.be("cp=two");
				return view.load('http://localhost/test', {
					content: '<html><body>A</body></html>'
				}).then(function() {
					return view.run(function(done) {
						done(null, document.cookie);
					});
				}).then(function(cookie) {
					expect(cookie).to.not.be.ok();
				});
			})
		});
	});
});


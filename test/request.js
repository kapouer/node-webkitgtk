const WebKit = require('../');
const expect = require('expect.js');

describe("request listener", () => {
	it("should load html content and filter some requests", function(done) {
		this.timeout(1000);
		let haspng = false;
		let hasjs = false;
		let hasdatauri = false;
		let hasSlash = false;
		const server = require('http').createServer((req, res) => {
			if (req.url == "/test.js") {
				res.statusCode = 200;
				res.end('console.log("hello");');
			} else {
				res.statusCode = 404;
				res.end("Not Found");
			}
		}).listen(() => {
			WebKit.load("http://localhost:" + server.address().port, {
				content: `<!DOCTYPE html>
				<html>
				<head>
				<script src="/test.js"></script>
				</head>
				<body>
				<img src="/test.png">
				<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">
				<img src="/slash/test.jpg">
				</body>
				</html>`,
				filter: [function(re) {
					if (/\.png$/.test(this.uri)) this.cancel = true;
					if (re.test(this.uri)) this.cancel = true;
					if (/^data:/.test(this.uri)) this.cancel = true;
				}, new RegExp('/slash/.*')]
			}, (err) => {
				expect(err).to.be(null);
			}).on('response', (res) => {
				if (/\/slash\/.*/.test(res.uri)) {
					hasSlash = true;
				}
				if (/\.png$/.test(res.uri)) {
					haspng = true;
				}
				if (/\.js$/.test(res.uri)) {
					hasjs = true;
				}
				if (/^data:/.test(res.uri)) {
					hasdatauri = true;
				}
			})
				.once('idle', () => {
					expect(haspng).to.not.be.ok();
					expect(hasSlash).to.not.be.ok();
					expect(hasjs).to.be.ok();
					expect(hasdatauri).to.not.be.ok();
					server.close();
					done();
				});
		});
	});

	it("should filter requests by regexp and let the main request go", function(done) {
		this.timeout(10000);
		const onlyjs = /\.js/;
		let hadmain = false;
		let hadjs = false;
		WebKit.load('http://twitter.com', {allow: onlyjs, console: true})
			.on('response', function(res) {
				if (res.uri == this.uri) hadmain = true;
				else {
					expect(onlyjs.test(res.uri)).to.be(true);
					hadjs = true;
				}
			})
			.once('idle', (err) => {
				expect(err).to.not.be.ok();
				expect(hadmain).to.be(true);
				expect(hadjs).to.be(true);
				done();
			});
	});

	it("should cancel the request by setting cancel = true in filter", function(done) {
		this.timeout(15000);
		WebKit((err, w) => {
			w.load("https://www.selmer.fr", {
				filter: function() {
					if (/\.js$/.test(this.uri)) this.cancel = true;
				},
				console: true
			}).on("request", (req) => {
				if (/\.js$/.test(req.uri)) expect(req.cancel).to.be(true);
			}).on("response", (res) => {
				expect(/\.js$/.test(res.uri)).to.not.be(true);
			}).once("load", () => {
				done();
			}).on("error", () => {
				// just ignore errors here
			});
		});
	});

	//	it("should set request headers", function(done) {
	//		var server = require('http').createServer(function(req, res) {
	//			expect(req.headers.custom).to.be("tada");
	//			expect(req.headers.accept).to.be("text/tomo");
	//			if (req.headers.cookie != undefined) {
	//				console.warn("container doesn't process Cookie header");
	//			}
	//			res.statusCode = 200;
	//			res.end("<html><body>test</body></html>");
	//		}).listen(function() {
	//			WebKit.load("http://localhost:" + server.address().port)
	//			.on('request', function(req) {
	//				req.headers.custom = "tada";
	//				req.headers.Accept = "text/tomo";
	//				req.headers.Cookie = 'abc="xyzzy!"; Expires=Tue, 18 Oct 2511 07:05:03 GMT; Path=/;';
	//			})
	//			.once('ready', function(err) {
	//				setTimeout(function() {
	//					server.close();
	//					done();
	//				}, 100);
	//			});
	//		});
	//	});

	it("should ignore stalled requests", function(done) {
		this.timeout(6000);
		const doc = `<html><head>
		<script type="text/javascript">
			var xhr = new XMLHttpRequest();
			xhr.open("GET", "/test", true);
			xhr.setRequestHeader("Content-Type", "application/json; charset=utf-8");
			xhr.addEventListener("load", function() {
				document.body.innerHTML = 'tata';
			});
			xhr.send();
		</script>
		</head><body>move along</body></html>`;
		const server = require('http').createServer((req, res) => {
			if (req.url == "/") {
				res.statusCode = 200;
				res.end(doc);
			} else if (req.url == "/test") {
				res.statusCode = 200;
				setTimeout(() => {
					res.end('{"hello": "tata"}');
				}, 2000);
			} else {
				expect("no 404").to.be("should happen");
				res.statusCode = 404;
				res.end();
			}
		}).listen(() => {
			WebKit((err, w) => {
				w.load("http://localhost:" + server.address().port, {console:true, stall: 1000})
					.once('idle', function() {
						this.html((err, str) => {
							expect(str).to.be(doc);
							setTimeout(() => {
								server.close();
								done();
							}, 100);
						});
					});
			});
		});
	});

	it("should ignore stalled fetch requests", function(done) {
		this.timeout(6000);
		const doc = `<html><head>
		<script type="text/javascript">
			fetch("/test").then(function() {
				document.body.innerHTML = "tata";
			});
		</script>
		</head><body>move along</body></html>`;
		const server = require('http').createServer((req, res) => {
			if (req.url == "/") {
				res.statusCode = 200;
				res.end(doc);
			} else if (req.url == "/test") {
				res.statusCode = 200;
				setTimeout(() => {
					res.end('{"hello": "tata"}');
				}, 2000);
			} else {
				expect("no 404").to.be("should happen");
				res.statusCode = 404;
				res.end();
			}
		}).listen(() => {
			WebKit((err, w) => {
				w.load("http://localhost:" + server.address().port, {console:true, stall: 1000})
					.once('idle', function() {
						this.html((err, str) => {
							expect(str).to.be(doc);
							setTimeout(() => {
								server.close();
								done();
							}, 100);
						});
					});
			});
		});
	});

	it("should allow to force ignore requests", function(done) {
		this.timeout(1000);
		const doc = '<html><head>\
		<script type="text/javascript">var xhr = new XMLHttpRequest();\
			xhr.open("GET", "/test", true);\
			xhr.setRequestHeader("Content-Type", "application/json; charset=utf-8");\
			xhr.send();</script></head>\
		<body>move along</body></html>';
		const server = require('http').createServer((req, res) => {
			if (req.url == "/") {
				res.statusCode = 200;
				res.end(doc);
			} else if (req.url == "/test") {
				res.statusCode = 200;
				setTimeout(() => {
					res.end('{"hello": "tata"}');
				}, 3000);
			} else {
				expect("no 404").to.be("should happen");
				res.statusCode = 404;
				res.end();
			}
		}).listen(() => {
			WebKit((err, w) => {
				w.load("http://localhost:" + server.address().port, {console:true, stall: 2000, filter: [function(what) {
					if (this.uri.indexOf(what) > 0) this.ignore = true;
				}, "test"]})
					.on('request', (req) => {
						if (req.uri.indexOf("test") > 0) expect(req.ignore).to.be(true);
					})
					.once('idle', function() {
						this.html((err, str) => {
							expect(str).to.be(doc);
							setTimeout(() => {
								server.close();
								done();
							}, 100);
						});
					});
			});
		});
	});

	it("should cancel xhr requests immediately", function(done) {
		// this typically is not the case if ret = TRUE in src/webextension.cc
		// and works if uri is set to ""
		this.timeout(3000);
		const doc = '<html><head>\
		<script type="text/javascript">var xhr = new XMLHttpRequest();\
			xhr.open("GET", "/test", true);\
			xhr.setRequestHeader("Content-Type", "application/json; charset=utf-8");\
			xhr.send();</script></head>\
		<body>move along</body></html>';
		const server = require('http').createServer((req, res) => {
			if (req.url == "/") {
				res.statusCode = 200;
				res.end(doc);
			} else if (req.url == "/test") {
				res.statusCode = 200;
				setTimeout(() => {
					res.end('{"hello": "tata"}');
				}, 3000);
			} else {
				expect("no 404").to.be("should happen");
				res.statusCode = 404;
				res.end();
			}
		}).listen(() => {
			WebKit((err, w) => {
				w.load("http://localhost:" + server.address().port, {console:true, stall: 2000, filter: function() {
					if (this.uri.indexOf('test') > 0) this.cancel = true;
				}})
					.on('request', (req) => {
						if (req.uri.indexOf('test') > 0) {
							expect(req.cancel).to.be(true);
						}
					})
					.once('idle', function() {
						this.html((err, str) => {
							expect(str).to.be(doc);
							setTimeout(() => {
								server.close();
								done();
							}, 100);
						});
					});
			});
		});
	});

	it("should count pendingRequests correctly in case of a redirected main page", function(done) {
		this.timeout(4000);
		const doc = '<html><head></head><body><img src="thing.png">move along</body></html>';
		let port;
		const server = require('http').createServer((req, res) => {
			if (req.url == "/") {
				res.statusCode = 302;
				res.setHeader('Location', 'http://localhost:' + port + '/?redirected');
				res.end();
			} else if (req.url == "/?redirected") {
				res.statusCode = 200;
				res.end(doc);
			} else if (req.url == "/thing.png") {
				res.write('stuf');
				res.end();
			} else {
				expect("no 404").to.be("should happen");
				res.statusCode = 404;
				res.end();
			}
		}).listen(() => {
			port = server.address().port;
			WebKit((err, w) => {
				w.load("http://localhost:" + port, {console:true, stall: 2000})
					.once('idle', function() {
						this.html((err, str) => {
							expect(str).to.be(doc);
							setTimeout(() => {
								server.close();
								done();
							}, 100);
						});
					});
			});
		});
	});

	it("should filter out requests that are not main document, twice in a row", function(done) {
		this.timeout(5000);
		const doc = '<html><head></head><body><img src="thing.png">move along</body></html>';
		let port;
		const server = require('http').createServer((req, res) => {
			res.statusCode = 200;
			res.end(doc);
		}).listen(() => {
			port = server.address().port;
			WebKit((err, w) => {
				let count = 0;
				const urla = "http://localhost:" + port + '/a';
				const urlb = "http://localhost:" + port + '/b';
				w.on('response', (res) => {
					if (res.uri == urla || res.uri == urlb) count++;
				});

				w.load(urla, {
					filter: function() {
						if (this.uri != document.location.toString()) this.cancel = true;
					}
				}).once('idle', () => {
					w.load(urlb, {
						filter: function() {
							if (this.uri != document.location.toString()) this.cancel = true;
						}
					}).once('idle', () => {
						expect(count).to.be(2);
						done();
					});
				});
			});
		});
	});

	it("should reject requests even when resource is in browser cache", function(done) {
		this.timeout(5000);
		const doc = `<!DOCTYPE html>
		<html><head>
		<script type="text/javascript" src="test.js"></script>
		</head><body>
		content
		</body></html>`;
		const server = require('http').createServer((req, res) => {
			if (req.url == "/test.js") {
				const delay = 60;
				res.setHeader('Expires', new Date(Date.now() + delay * 1000).toUTCString());
				res.setHeader('Cache-Control', 'max-age=' + delay);
				res.statusCode = 200;
				res.setHeader('Content-Type', "text/javascript");
				res.end("console.log('test has run');");
			} else if (req.url == "/") {
				res.statusCode = 200;
				res.end(doc);
			} else {
				res.statusCode = 404;
				res.end("Not Found");
			}
		}).listen(() => {
			const url = "http://localhost:" + server.address().port;
			WebKit((err, w) => {
				let count = 0;
				w.on('response', (res) => {
					if (res.uri == url + "/test.js") count++;
				});

				w.load(url).once('idle', () => {
					w.load(url, {
						filter: function() {
							if (this.uri != document.location.toString()) this.cancel = true;
						}
					}).once('idle', () => {
						expect(count).to.be(1);
						done();
					});
				});
			});
		});
	});
});

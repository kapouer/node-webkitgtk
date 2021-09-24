const WebKit = require('../');
const expect = require('expect.js');

describe("idle event", () => {
	it("should chain lots of promises on client while doing xhr and idle after end of promises", (done) => {
		let hasXHR = false;
		const server = require('http').createServer((req, res) => {
			if (req.url == "/xhr") {
				res.statusCode = 200;
				hasXHR = true;
				res.setHeader('Content-Type', 'application/json');
				setTimeout(() => {
					res.end(JSON.stringify({
						test: 'xhr'
					}));
				}, 100);
			} else {
				res.statusCode = 404;
				res.end("Not Found");
			}
		}).listen(() => {
			WebKit.load("http://localhost:" + server.address().port, {
				console: true,
				content: `<!DOCTYPE html>
				<html><head><script type="text/javascript">
				fetch('/xhr').then((res) => res.json()).then(function(data) {
					document.querySelector('#xhr').innerHTML = data.test;
				}).then(function() {
					var n = 100;
					var p = Promise.resolve();
					for (var i=0; i < n; i++) {
						p = p.then(function() {
							var d = document.createElement("p");
							d.innerHTML = "toto";
							document.body.appendChild(d);
						});
					}
					p.then(function() {
						document.querySelector('#xhr').innerHTML += i;
					});
				});
				</script></head><body>
					<div id="xhr"></div>
				</body></html>`
			}, (err) => {
				expect(err).to.be(null);
			})
				.once('idle', function() {
					expect(hasXHR).to.be.ok();
					this.html().then((str) => {
						expect(str.indexOf('<div id="xhr">xhr100</div>')).to.be.greaterThan(0);
					}).then(done).catch(done);
				});
		});
	});
	it("should wait xhr requests called in chain, even with a zero timeout delay", function(done) {
		this.timeout(5000);
		let hasXHR1 = false;
		let hasXHR2 = false;
		const server = require('http').createServer((req, res) => {
			if (req.url == "/xhr1") {
				res.statusCode = 200;
				hasXHR1 = true;
				res.setHeader('Content-Type', 'application/json');
				setTimeout(() => {
					res.end(JSON.stringify({
						test: 'xhr1'
					}));
				}, 100);
			} else if (req.url == "/xhr2") {
				res.statusCode = 200;
				hasXHR2 = true;
				res.setHeader('Content-Type', 'application/json');
				setTimeout(() => {
					res.end(JSON.stringify({
						test: 'xhr2'
					}));
				}, 100);
			} else {
				res.statusCode = 404;
				res.end("Not Found");
			}
		}).listen(() => {
			WebKit.load("http://localhost:" + server.address().port, {
				console: true,
				content: `<!DOCTYPE html>
				<html><head><script type="text/javascript">
				function getJson(url, cb) {
					var xhr = new XMLHttpRequest();
					xhr.open("GET", url, true);
					xhr.setRequestHeader("Accept", "application/json; q=1.0");

					xhr.onreadystatechange = function() {
						if (this.readyState != this.DONE) return;
						cb(null, JSON.parse(this.response));
					};
					xhr.send();
				}
				getJson('/xhr1', function(err, data) {
					document.querySelector('#xhr1').innerHTML = data.test;
					setTimeout(function() {
						getJson('/xhr2', function(err, data) {
							document.querySelector('#xhr2').innerHTML = data.test;
						});
					}, 0);
				});
				</script></head><body>
					<div id="xhr1"></div>
					<div id="xhr2"></div>
				</body></html>`
			}, (err) => {
				expect(err).to.be(null);
			})
				.once('idle', function() {
					this.run((done) => {
						done(null,
							document.querySelector('#xhr1').innerHTML,
							document.querySelector('#xhr2').innerHTML
						);
					}, (err, xhr1, xhr2) => {
						expect(xhr1).to.be('xhr1');
						expect(xhr2).to.be('xhr2');
						server.close();
						done();
					});
					expect(hasXHR1).to.be.ok();
					expect(hasXHR2).to.be.ok();
				});
		});
	});

	it("should wait xhr requests called in chain, even with promises", function(done) {
		this.timeout(5000);
		let hasXHR1 = false;
		let hasXHR2 = false;
		const server = require('http').createServer((req, res) => {
			if (req.url == "/xhr1") {
				res.statusCode = 200;
				hasXHR1 = true;
				res.setHeader('Content-Type', 'application/json');
				setTimeout(() => {
					res.end(JSON.stringify({
						test: 'xhr1'
					}));
				}, 100);
			} else if (req.url == "/xhr2") {
				res.statusCode = 200;
				hasXHR2 = true;
				res.setHeader('Content-Type', 'application/json');
				setTimeout(() => {
					res.end(JSON.stringify({
						test: 'xhr2'
					}));
				}, 100);
			} else {
				res.statusCode = 404;
				res.end("Not Found");
			}
		}).listen(() => {
			WebKit.load("http://localhost:" + server.address().port, {
				console: true,
				content: `<!DOCTYPE html>
				<html><head><script type="text/javascript">
				function getJson(url) {
					var resolve, reject;
					var p = new Promise(function(f, r) {
						resolve = f;
						reject = r;
					});
					var xhr = new XMLHttpRequest();
					xhr.open("GET", url, true);
					xhr.setRequestHeader("Accept", "application/json; q=1.0");

					xhr.onreadystatechange = function() {
						if (this.readyState != this.DONE) return;
						resolve(JSON.parse(this.response));
					};
					xhr.send();
					return p;
				}
				Promise.resolve().then(function() {
					return Promise.all([getJson('/xhr1'), getJson('/xhr2')]).then(function(datas) {
						document.querySelector('#xhr1').innerHTML = datas[0].test;
						document.querySelector('#xhr2').innerHTML = datas[1].test;
						return Promise.resolve("end");
					});
				}).then(function(end) {
					document.querySelector('#end').innerHTML = end;
				});
				</script></head><body>
					<div id="xhr1"></div>
					<div id="xhr2"></div>
					<div id="end"></div>
				</body></html>`
			}, (err) => {
				expect(err).to.be(null);
			})
				.once('idle', function() {
					this.run((done) => {
						done(null,
							document.querySelector('#xhr1').innerHTML,
							document.querySelector('#xhr2').innerHTML,
							document.querySelector('#end').innerHTML
						);
					}, (err, xhr1, xhr2, end) => {
						expect(xhr1).to.be('xhr1');
						expect(xhr2).to.be('xhr2');
						expect(end).to.be('end');
						server.close();
						done();
					});
					expect(hasXHR1).to.be.ok();
					expect(hasXHR2).to.be.ok();
				});
		});
	});

	it("should wait script node to load then some other script node", function(done) {
		this.timeout(5000);
		let hasJS1 = false;
		let hasJS2 = false;
		const server = require('http').createServer((req, res) => {
			if (req.url == "/one.js") {
				res.statusCode = 200;
				hasJS1 = true;
				res.setHeader('Content-Type', 'text/javascript');
				setTimeout(() => {
					res.end("window.hasJS1 = true;");
				}, 300);
			} else if (req.url == "/two.js") {
				res.statusCode = 200;
				hasJS2 = true;
				res.setHeader('Content-Type', 'text/javascript');
				setTimeout(() => {
					res.end("window.hasJS2 = true;");
				}, 300);
			} else {
				res.statusCode = 404;
				res.end("Not Found");
			}
		}).listen(() => {
			WebKit.load("http://localhost:" + server.address().port, {
				console: true,
				content: `<!DOCTYPE html>
				<html><head><script type="text/javascript">
				function readyNode(node) {
					return new Promise(function(resolve, reject) {
						function done() {
							node.removeEventListener('load', done);
							node.removeEventListener('error', done);
							resolve();
						}
						node.addEventListener('load', done);
						node.addEventListener('error', done);
					});
				}
				function loadScript(url) {
					var one = document.createElement('script');
					one.src = url;
					document.head.appendChild(one);
					return readyNode(one);
				}
				window.onload = function() {
					loadScript('/one.js').then(function() {
						loadScript('/two.js').then(function() {
							document.body.innerHTML = "Success ? " + window.hasJS1 + "," + window.hasJS2;
						});
					});
				};
				</script></head><body>
				</body></html>`
			}, (err) => {
				expect(err).to.be(null);
			})
				.once('idle', function() {
					this.run((done) => {
						done(null, document.body.innerHTML);
					}, (err, inner) => {
						expect(inner).to.be('Success ? true,true');
						server.close();
						done();
					});
					expect(hasJS1).to.be.ok();
					expect(hasJS2).to.be.ok();
				});
		});
	});

	it("should wait fetch requests called in chain, even with a zero timeout delay", function(done) {
		this.timeout(6000);
		let hasXHR1 = false;
		let hasXHR2 = false;
		let hasXHR3 = false;
		const server = require('http').createServer((req, res) => {
			if (req.url == "/xhr1") {
				res.statusCode = 200;
				hasXHR1 = true;
				res.setHeader('Content-Type', 'application/json');
				setTimeout(() => {
					res.end(JSON.stringify({
						test: 'xhr1'
					}));
				}, 100);
			} else if (req.url == "/xhr2") {
				res.statusCode = 200;
				hasXHR2 = true;
				res.setHeader('Content-Type', 'application/json');
				setTimeout(() => {
					res.end(JSON.stringify({
						test: 'xhr2'
					}));
				}, 100);
			} else if (req.url == "/xhr3") {
				res.statusCode = 500;
				hasXHR3 = true;
				res.setHeader('Content-Type', 'application/json');
				setTimeout(() => {
					res.end(JSON.stringify({
						test: 'xhr3'
					}));
				}, 100);
			} else {
				res.statusCode = 404;
				res.end("Not Found");
			}
		}).listen(() => {
			WebKit.load("http://localhost:" + server.address().port, {
				console: true,
				content: `<!DOCTYPE html>
				<html><head><script type="text/javascript">
				function getJson(url, cb) {
					fetch(url).then(function(res) {
						return res.json();
					}).then(function(json) {
						cb(null, json);
					}).catch(cb);
				}
				getJson('/xhr1', function(err, data) {
					document.querySelector('#xhr1').innerHTML = data.test;
					setTimeout(function() {
						getJson('/xhr2', function(err, data) {
							document.querySelector('#xhr2').innerHTML = data.test;
						});
					}, 0);
					fetch('/xhr3').then(function(res) {
						document.querySelector('#xhr3').innerHTML = "error" + res.status;
					});
				});
				</script></head><body>
					<div id="xhr1"></div>
					<div id="xhr2"></div>
					<div id="xhr3"></div>
				</body></html>`
			}, (err) => {
				expect(err).to.be(null);
			})
				.once('idle', function() {
					this.run((done) => {
						done(null,
							document.querySelector('#xhr1').innerHTML,
							document.querySelector('#xhr2').innerHTML,
							document.querySelector('#xhr3').innerHTML
						);
					}, (err, xhr1, xhr2, xhr3) => {
						expect(xhr1).to.be('xhr1');
						expect(xhr2).to.be('xhr2');
						expect(xhr3).to.be('error500');
						server.close();
						done();
					});
					expect(hasXHR1).to.be.ok();
					expect(hasXHR2).to.be.ok();
					expect(hasXHR3).to.be.ok();
				});
		});
	});

	it("should wait fetch requests called in parallel", function(done) {
		this.timeout(1000);
		const server = require('http').createServer((req, res) => {
			res.statusCode = 200;
			res.setHeader('Content-Type', 'application/json');
			res.end(JSON.stringify({
				path: req.url
			}));
		}).listen(() => {
			WebKit.load("http://localhost:" + server.address().port, {
				console: true,
				content: `<!DOCTYPE html>
				<html><head><script type="text/javascript">
					Promise.all([
						fetch('/test1'),
						fetch('/test2'),
						fetch('/test3'),
						fetch('/test4'),
						fetch('/test5'),
						fetch('/test6')
					]).then(function(arr) {
						return Promise.all(arr.map(res => res.json()));
					}).then(function(objs) {
						var paths = objs.map(x => x.path);
						document.getElementById('results').textContent = paths.join(',');
					});
				</script></head><body>
					<div id="results"></div>
				</body></html>`
			}, (err) => {
				expect(err).to.be(null);
			})
				.once('idle', function() {
					this.run((done) => {
						done(null, document.querySelector('#results').innerHTML);
					}, (err, list) => {
						expect(list).to.be('/test1,/test2,/test3,/test4,/test5,/test6');
						server.close();
						done();
					});
				});
		});
	});

});

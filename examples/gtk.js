var W = require('../')
W.load('https://deepu.js.org/angular-clock/', {
	offscreen: false,
	resizing: true,
	transparent: true,
	decorated: false,
	style: 'html,body {background-color:transparent !important;opacity:0.8}',
	width: 400,
	height: 600
})
.once('ready', function() {
	this.run(function() {
		var f = document.querySelector('ds-widget-clock');
		document.body.innerHTML = "";
		document.body.appendChild(f);
	});
});


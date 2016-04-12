#!/bin/sh

# load about:blank with "fetch(url).then()" polyfill
webkitgtk --scripts https://raw.githubusercontent.com/github/fetch/master/fetch.js

# load foreign site and watch requests
webkitgtk --verbose https://www.reddit.com

# Content-Security-Policy headers currently prevent us from tracking some responses
webkitgtk --show --verbose https://www.github.com

# Show a transparent png on your desktop
webkitgtk --show --bare --transparent --verbose https://upload.wikimedia.org/wikipedia/commons/thumb/e/ec/Tibia_insulaechorab_transparent.png/320px-Tibia_insulaechorab_transparent.png

# A transparent clock
webkitgtk --show --bare --transparent --verbose http://phhht.com/putz/clock.html

# set a style, run a command and show everything in transparent mode
# unfortunately buggy on some webkit2gtk versions
webkitgtk --show --bare --transparent --verbose --command 'document.body.webkitRequestFullScreen();' --style 'body:-webkit-full-screen {width:100%;height:100%;}' http://phhht.com/putz/clock.html

# print to pdf
webkitgtk --pdf test.pdf --margins 20,20,20,20 --unit mm http://google.fr


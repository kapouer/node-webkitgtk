#include "webview.h"
#include "selfmessage.h"


SelfMessage::SelfMessage(WebView* w, NanUtf8String* m) {
	view = w;
	message = m;
}


SelfMessage::~SelfMessage() {
	if (message != NULL) {
		delete message;
		message = NULL;
	}
	if (view != NULL) view = NULL;
}





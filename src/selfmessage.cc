#include "selfmessage.h"
#include <glib.h>

SelfMessage::SelfMessage(void* w, char* m) {
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


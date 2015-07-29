class WebView;

class SelfMessage {
	public:
	WebView* view;
	NanUtf8String* message;
	SelfMessage(WebView* w, NanUtf8String* m);
	~SelfMessage();
};


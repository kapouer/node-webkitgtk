#include <JavaScriptCore/JSValueRef.h>
#include <JavaScriptCore/JSStringRef.h>
#include <node.h>
#include "utils.h"
#include "webview.h"
#include "gvariantproxy.h"
#include "webresponse.h"
#include "webauthrequest.h"
#include "dbus.h"


using namespace v8;

Nan::Persistent<Function> WebView::constructor;

static const GDBusInterfaceVTable interface_vtable = {
	WebView::handle_method_call,
	NULL,
	NULL,
	NULL
};
static uv_timer_t timeout_handle;

WebView::WebView(Handle<Object> opts) {
	this->eventName = getStr(opts, "eventName");
	this->requestCallback = getCb(opts, "requestListener");
	this->receiveDataCallback = getCb(opts, "receiveDataListener");
	this->responseCallback = getCb(opts, "responseListener");
	this->eventsCallback = getCb(opts, "eventsListener");
	this->policyCallback = getCb(opts, "policyListener");
	this->authCallback = getCb(opts, "authListener");
	this->closeCallback = getCb(opts, "closedListener");

	this->offscreen = opts->Get(H("offscreen"))->BooleanValue();
	bool hasInspector = opts->Get(H("inspector"))->BooleanValue();

	Nan::AdjustExternalMemory(400000);

	state = 0;
	signalResourceResponse = 0;

	guid = g_dbus_generate_guid();

	instances.insert(ObjMapPair(guid, this));

	GDBusServerFlags server_flags = G_DBUS_SERVER_FLAGS_NONE;
	GError* error = NULL;
	gchar* address = g_strconcat("unix:tmpdir=", g_get_tmp_dir(), "/node-webkitgtk", NULL);
	this->server = g_dbus_server_new_sync(address, server_flags, guid, NULL, NULL, &error);
	g_dbus_server_start(this->server);

	if (server == NULL) {
		g_printerr("Error creating server at address %s: %s\n", address, error->message);
		g_error_free(error);
		Nan::ThrowError("WebKitGtk could not create dbus server");
		return;
	}
	g_signal_connect(this->server, "new-connection", G_CALLBACK(on_new_connection), this);

	WebKitWebContext* context = webkit_web_context_get_default();
	const gchar* cacheDir = getStr(opts, "cacheDir");
	if (cacheDir == NULL) {
		cacheDir = g_build_filename(g_get_user_cache_dir(), "node-webkitgtk", NULL);
	}
	webkit_web_context_set_disk_cache_directory(context, cacheDir);
	webkit_web_context_set_process_model(context, WEBKIT_PROCESS_MODEL_MULTIPLE_SECONDARY_PROCESSES);
	webkit_web_context_set_cache_model(context, WEBKIT_CACHE_MODEL_DOCUMENT_VIEWER);
	webkit_web_context_set_tls_errors_policy(context, WEBKIT_TLS_ERRORS_POLICY_IGNORE);

	const gchar* cookiePolicy = getStr(opts, "cookiePolicy");
	WebKitCookieManager* cookieManager = webkit_web_context_get_cookie_manager(context);
	if (!g_strcmp0(cookiePolicy, "never")) {
		webkit_cookie_manager_set_accept_policy(cookieManager, WEBKIT_COOKIE_POLICY_ACCEPT_NEVER);
	} else if (!g_strcmp0(cookiePolicy, "always")) {
		webkit_cookie_manager_set_accept_policy(cookieManager, WEBKIT_COOKIE_POLICY_ACCEPT_ALWAYS);
	} else {
		webkit_cookie_manager_set_accept_policy(cookieManager, WEBKIT_COOKIE_POLICY_ACCEPT_NO_THIRD_PARTY);
	}

	const gchar* wePath = getStr(opts, "webextension");
	if (wePath != NULL) {
		webkit_web_context_set_web_extensions_directory(context, wePath);
		this->contextSignalId = g_signal_connect(context, "initialize-web-extensions", G_CALLBACK(WebView::InitExtensions), this);
	}

	view = WEBKIT_WEB_VIEW(webkit_web_view_new_with_user_content_manager(webkit_user_content_manager_new()));

	if (!this->offscreen) {
		window = gtk_window_new(GTK_WINDOW_TOPLEVEL);
	} else {
		window = gtk_offscreen_window_new();
	}

	// WindowClosed will in turn call destroy (through webkitgtk.js closedListener)
	g_signal_connect(window, "destroy", G_CALLBACK(WebView::WindowClosed), this);

	GdkScreen* screen = gtk_window_get_screen(GTK_WINDOW(window));
	GdkVisual* rgba_visual = gdk_screen_get_rgba_visual(screen);
	if (rgba_visual) {
		gtk_widget_set_visual(window, rgba_visual);
#if WEBKIT_CHECK_VERSION(2,7,4)
		transparencySupport = TRUE;
#endif
	}
	gtk_widget_set_app_paintable(window, TRUE);

	gtk_container_add(GTK_CONTAINER(window), GTK_WIDGET(view));
	gtk_widget_show_all(window);

	if (hasInspector) {
		g_object_set(G_OBJECT(webkit_web_view_get_settings(view)), "enable-developer-extras", TRUE, NULL);
		inspector = webkit_web_view_get_inspector(view);
		g_signal_connect(inspector, "closed", G_CALLBACK(WebView::InspectorClosed), this);
	} else {
		g_object_set(G_OBJECT(webkit_web_view_get_settings(view)), "enable-developer-extras", FALSE, NULL);
	}

	g_signal_connect(view, "authenticate", G_CALLBACK(WebView::Authenticate), this);
	g_signal_connect(view, "load-failed", G_CALLBACK(WebView::Fail), this);
	g_signal_connect(view, "load-changed", G_CALLBACK(WebView::Change), this);
	g_signal_connect(view, "script-dialog", G_CALLBACK(WebView::ScriptDialog), this);
	g_signal_connect(view, "decide-policy", G_CALLBACK(WebView::DecidePolicy), this);
}

NAN_METHOD(WebView::Stop) {
	Nan::HandleScope scope;
	WebView* self = ObjectWrap::Unwrap<WebView>(info.This());
	bool wasLoading = FALSE;
	if (self->loadCallback != NULL) {
		wasLoading = TRUE;
	}
	if (wasLoading == TRUE) self->stopCallback = new Nan::Callback(info[0].As<Function>());
	webkit_web_view_stop_loading(self->view);
	info.GetReturnValue().Set(Nan::New<Boolean>(wasLoading));
}

NAN_METHOD(WebView::Destroy) {
	Nan::HandleScope scope;
	WebView* self = ObjectWrap::Unwrap<WebView>(info.This());
	self->destroy();
	return;
}

void WebView::destroy() {
	if (view == NULL) return;
	unloaded();
	view = NULL;
	inspector = NULL;
	if (window != NULL) {
		gtk_widget_destroy(window);
		window = NULL;
	}

	if (uri != NULL) g_free(uri);

	if (pngCallback != NULL) delete pngCallback;
	if (pngFilename != NULL) delete pngFilename;

	if (printCallback != NULL) delete printCallback;
	if (printUri != NULL) delete printUri;

	if (loadCallback != NULL) delete loadCallback;
	if (stopCallback != NULL) delete stopCallback;
	if (requestCallback != NULL) delete requestCallback;
	if (receiveDataCallback != NULL) delete receiveDataCallback;
	if (responseCallback != NULL) delete responseCallback;
	if (policyCallback != NULL) delete policyCallback;
	if (eventsCallback != NULL) delete eventsCallback;
	if (authCallback != NULL) delete authCallback;
	if (closeCallback != NULL) delete closeCallback;

	g_dbus_server_stop(server);
	g_object_unref(server);
	instances.erase(guid);
	g_free(guid);
}

WebView::~WebView() {
	destroy();
}


void WebView::unloaded() {
	if (view == NULL) return;
	if (signalResourceResponse > 0) {
		g_signal_handler_disconnect(view, signalResourceResponse);
		signalResourceResponse = 0;
	}
	WebKitUserContentManager* contman = webkit_web_view_get_user_content_manager(view);
	if (contman != NULL) {
		webkit_user_content_manager_remove_all_scripts(contman);
		webkit_user_content_manager_remove_all_style_sheets(contman);
	}
}

void timeout_cb(uv_timer_t *handle, int status) {
	while (gtk_events_pending()) {
		gtk_main_iteration_do(true);
	}
}

void WebView::Init(Handle<Object> exports, Handle<Object> module) {
	node::AtExit(Exit);
	const gchar* introspection_xml =
	"<node>"
	"	<interface name='org.nodejs.WebKitGtk.WebView'>"
	"		<method name='HandleRequest'>"
	"			<arg type='a{sv}' name='dict' direction='in'/>"
	"			<arg type='a{sv}' name='dict' direction='out'/>"
	"		</method>"
	"		<method name='NotifyEvent'>"
	"			<arg type='s' name='message' direction='in'/>"
	"		</method>"
	"	</interface>"
	"</node>";

	introspection_data = g_dbus_node_info_new_for_xml(introspection_xml, NULL);
	g_assert(introspection_data != NULL);

	Local<FunctionTemplate> tpl = Nan::New<FunctionTemplate>(WebView::New);
	tpl->SetClassName(Nan::New("WebView").ToLocalChecked());
	tpl->InstanceTemplate()->SetInternalFieldCount(1);

	Nan::SetPrototypeMethod(tpl, "load", WebView::Load);
	Nan::SetPrototypeMethod(tpl, "run", WebView::Run);
	Nan::SetPrototypeMethod(tpl, "runSync", WebView::RunSync);
	Nan::SetPrototypeMethod(tpl, "png", WebView::Png);
	Nan::SetPrototypeMethod(tpl, "pdf", WebView::Print);
	Nan::SetPrototypeMethod(tpl, "stop", WebView::Stop);
	Nan::SetPrototypeMethod(tpl, "destroy", WebView::Destroy);
	Nan::SetPrototypeMethod(tpl, "inspect", WebView::Inspect);

	ATTR(tpl, "uri", get_prop, NULL);

	constructor.Reset(tpl->GetFunction());

	module->Set(Nan::New("exports").ToLocalChecked(), tpl->GetFunction());
	GVariantProxy::Init(exports);
	WebResponse::Init(exports);
	WebAuthRequest::Init(exports);

	gtk_init(0, NULL);
	uv_timer_init(uv_default_loop(), &timeout_handle);
	uv_timer_start(&timeout_handle, timeout_cb, 0, 5);
}

void WebView::InspectorClosed(WebKitWebInspector* inspector, gpointer data) {
	WebView* self = (WebView*)data;
	Local<Value> argv[] = { Nan::New<String>("inspector").ToLocalChecked() };
	self->closeCallback->Call(1, argv);
}

void WebView::WindowClosed(GtkWidget* window, gpointer data) {
	// wait until window has finished closing
	while (gtk_events_pending()) {
		gtk_main_iteration_do(true);
	}
	WebView* self = (WebView*)data;
	self->window = NULL;
	Local<Value> argv[] = { Nan::New<String>("window").ToLocalChecked() };
	self->closeCallback->Call(1, argv);
}

gboolean WebView::Authenticate(WebKitWebView* view, WebKitAuthenticationRequest* request, gpointer data) {
	WebView* self = (WebView*)data;
	if (webkit_authentication_request_is_retry(request)) return TRUE;

	// WebKitCredential* savedCred = webkit_authentication_request_get_proposed_credential(request);
	// if (savedCred != NULL) {
		// g_print("saved cred %s\n", webkit_credential_get_username(savedCred));
		// webkit_authentication_request_authenticate(request, savedCred);
		// return TRUE;
	// }

	Local<Object> obj = Nan::New<FunctionTemplate>(WebAuthRequest::constructor)->GetFunction()->NewInstance();
	WebAuthRequest* selfAuthRequest = node::ObjectWrap::Unwrap<WebAuthRequest>(obj);
	selfAuthRequest->init(request);

	Local<Value> argv[] = { obj };
	Local<Value> ignore = self->authCallback->Call(1, argv);
	if (ignore->IsBoolean() && ignore->BooleanValue() == true) {
		webkit_authentication_request_authenticate(request, NULL);
	}
	return TRUE;
}

void WebView::InitExtensions(WebKitWebContext* context, gpointer data) {
	WebView* self = (WebView*)data;
	if (self->contextSignalId) {
		g_signal_handler_disconnect(context, self->contextSignalId);
		self->contextSignalId = 0;
	}
	GVariant* userData = g_variant_new("(ss)", g_dbus_server_get_client_address(self->server), self->eventName);
	webkit_web_context_set_web_extensions_initialization_user_data(context, userData);
}

gboolean WebView::DecidePolicy(WebKitWebView* web_view, WebKitPolicyDecision* decision, WebKitPolicyDecisionType type, gpointer data) {
	WebView* self = (WebView*)data;
	if (type == WEBKIT_POLICY_DECISION_TYPE_NAVIGATION_ACTION) {
		WebKitNavigationPolicyDecision* navDecision = WEBKIT_NAVIGATION_POLICY_DECISION(decision);
		WebKitNavigationAction* navAction = webkit_navigation_policy_decision_get_navigation_action(navDecision);
		WebKitURIRequest* navRequest = webkit_navigation_action_get_request(navAction);
		Local<String> uri = Nan::New<String>(webkit_uri_request_get_uri(navRequest)).ToLocalChecked();
		Local<String> type = Nan::New<String>("navigation").ToLocalChecked();
		Local<Value> argv[] = { type, uri };
		Local<Value> ignore = self->policyCallback->Call(2, argv);
		if (ignore->IsBoolean() && ignore->BooleanValue() == true) {
			webkit_policy_decision_ignore(decision);
			return TRUE;
		}
	} else if (type == WEBKIT_POLICY_DECISION_TYPE_NEW_WINDOW_ACTION) {
		// ignore for now
		webkit_policy_decision_ignore(decision);
		return TRUE;
		// WebKitNavigationPolicyDecision* navDecision = WEBKIT_NAVIGATION_POLICY_DECISION(decision);
		// WebKitURIRequest* navRequest = webkit_navigation_policy_decision_get_request(navDecision);
		// const gchar* uri = webkit_uri_request_get_uri(navRequest);
		// g_print("policy new window decision for\n%s\n", uri);
	} else if (type == WEBKIT_POLICY_DECISION_TYPE_RESPONSE) {
		// WebKitResponsePolicyDecision* resDecision = WEBKIT_RESPONSE_POLICY_DECISION(decision);
		// WebKitURIRequest* resRequest = webkit_response_policy_decision_get_request(resDecision);
		// const gchar* uri = webkit_uri_request_get_uri(resRequest);
		// g_print("policy response decision for\n%s\n", uri);
	}
	return FALSE;
}

void WebView::ResourceLoad(WebKitWebView* web_view, WebKitWebResource* resource, WebKitURIRequest* request, gpointer data) {
	g_signal_connect(resource, "finished", G_CALLBACK(WebView::ResourceResponse), data);
	g_signal_connect(resource, "received-data", G_CALLBACK(WebView::ResourceReceiveData), data);
}

void WebView::ResourceReceiveData(WebKitWebResource* resource, guint64 length, gpointer data) {
	if (data == NULL) return;
	ViewClosure* vc = (ViewClosure*)data;
	if (vc->closure == NULL) return;
	WebView* self = (WebView*)(vc->view);
	const gchar* uri = webkit_web_resource_get_uri(resource);
	int argc = 3;
	Local<Value> argv[] = {
		Nan::New<String>((char*)vc->closure).ToLocalChecked(),
		Nan::New<String>(uri).ToLocalChecked(),
		Nan::New<Integer>((int)length)
	};
	self->receiveDataCallback->Call(argc, argv);
}

void WebView::ResourceResponse(WebKitWebResource* resource, gpointer data) {
	if (data == NULL) return;
	ViewClosure* vc = (ViewClosure*)data;
	if (vc->closure == NULL) return;
	WebView* self = (WebView*)(vc->view);
	WebKitURIResponse* response = webkit_web_resource_get_response(resource);
	Local<Object> obj = Nan::New<FunctionTemplate>(WebResponse::constructor)->GetFunction()->NewInstance();
	WebResponse* selfResponse = node::ObjectWrap::Unwrap<WebResponse>(obj);
	selfResponse->init(resource, response);
	int argc = 2;
	Local<Value> argv[] = {
		Nan::New<String>((char*)vc->closure).ToLocalChecked(),
		obj
	};
	self->responseCallback->Call(argc, argv);
}

gboolean WebView::ScriptDialog(WebKitWebView* web_view, WebKitScriptDialog* dialog, WebView* self) {
	if (!self->allowDialogs) return TRUE;
	else return FALSE;
}

guint getStatusFromView(WebKitWebView* web_view) {
	WebKitWebResource* resource = webkit_web_view_get_main_resource(web_view);
	if (resource != NULL) {
		WebKitURIResponse* response = webkit_web_resource_get_response(resource);
		if (response != NULL) {
			return webkit_uri_response_get_status_code(response);
		}
	}
	return 0;
}

void WebView::updateUri(const gchar* uri) {
	if (uri != NULL) {
		if (this->uri != NULL) g_free(this->uri);
		this->uri = g_strdup(uri);
	}
}

void WebView::Change(WebKitWebView* web_view, WebKitLoadEvent load_event, gpointer data) {
	WebView* self = (WebView*)data;
	Nan::Callback* cb;
	const gchar* uri = webkit_web_view_get_uri(web_view);
//	g_print("change %d %d %s %s\n", load_event, self->state, self->uri, uri);
	switch (load_event) {
		case WEBKIT_LOAD_STARTED: // 0
			/* New load, we have now a provisional URI */
			// provisional_uri = webkit_web_view_get_uri (web_view);
			/* Here we could start a spinner or update the
			* location bar with the provisional URI */
			self->state = DOCUMENT_LOADING;
			self->updateUri(uri);
		break;
		case WEBKIT_LOAD_REDIRECTED: // 1
			// redirected_uri = webkit_web_view_get_uri (web_view);
			if (self->state == DOCUMENT_LOADING) self->updateUri(uri);
		break;
		case WEBKIT_LOAD_COMMITTED: // 2
			/* The load is being performed. Current URI is
			* the final one and it won't change unless a new
			* load is requested or a navigation within the
			* same page is performed */
			if (self->state == DOCUMENT_LOADING) {
				self->state = DOCUMENT_LOADED;
				self->updateUri(uri);
				if (self->loadCallback != NULL && self->waitFinish == FALSE && self->stopCallback == NULL) {
					guint status = getStatusFromView(web_view);
					if (status == 0 && self->userContent == TRUE) status = 200;
					Local<Value> argv[] = {
						Nan::Null(),
						Nan::New<Integer>(status)
					};
					cb = self->loadCallback;
					self->loadCallback = NULL;
					cb->Call(2, argv);
					delete cb;
				}
			}
		break;
		case WEBKIT_LOAD_FINISHED: // 3
			self->state = DOCUMENT_AVAILABLE;
			if (self->loadCallback != NULL && self->waitFinish == TRUE) {
				guint status = getStatusFromView(web_view);
				if (status == 0 && self->userContent == TRUE) status = 200;
				Local<Value> argv[] = {
					Nan::Null(),
					Nan::New<Integer>(status)
				};
				cb = self->loadCallback;
				self->loadCallback = NULL;
				cb->Call(2, argv);
				delete cb;
			}
			if (self->stopCallback != NULL) {
				Local<Value> argvstop[] = {};
				cb = self->stopCallback;
				self->stopCallback = NULL;
				cb->Call(0, argvstop);
				delete cb;
			}
		break;
	}
}

gboolean WebView::Fail(WebKitWebView* web_view, WebKitLoadEvent load_event, gchar* failing_uri, GError* error, gpointer data) {
	WebView* self = (WebView*)data;
	Nan::Callback* cb;
//  g_print("fail %d %d %s %s\n", load_event, self->state, self->uri, failing_uri);
	if (self->state >= DOCUMENT_LOADING && g_strcmp0(failing_uri, self->uri) == 0) {
		if (self->loadCallback != NULL) {
			self->state = DOCUMENT_ERROR;
			Local<Value> argv[] = {
				Nan::Error(error->message),
				Nan::New<Integer>(getStatusFromView(web_view))
			};
			cb = self->loadCallback;
			self->loadCallback = NULL;
			cb->Call(2, argv);
			delete cb;
		}
		return TRUE;
	} else {
		return FALSE;
	}
}

NAN_METHOD(WebView::New) {
	Nan::HandleScope scope;
	WebView* self = new WebView(info[0]->ToObject());
	self->Wrap(info.This());
	info.GetReturnValue().Set(info.This());
}

NAN_METHOD(WebView::Load) {
	Nan::HandleScope scope;
	WebView* self = ObjectWrap::Unwrap<WebView>(info.This());

	if (!info[3]->IsFunction()) {
		Nan::ThrowError("load(uri, opts, cb) missing cb argument");
		return;
	}
	Nan::Callback* loadCb = new Nan::Callback(info[3].As<Function>());

	if (self->state == DOCUMENT_LOADING) {
		Local<Value> argv[] = {
			Nan::Error("A document is already being loaded")
		};
		if (loadCb != NULL) {
			loadCb->Call(1, argv);
			delete loadCb;
		}
		return;
	}

	if (!info[0]->IsString()) {
		Local<Value> argv[] = {
			Nan::Error("load(uri, opts, cb) expected a string for uri argument")
		};
		if (loadCb != NULL) {
			loadCb->Call(1, argv);
			delete loadCb;
		}
		return;
	}

	Nan::Utf8String* uri = new Nan::Utf8String(info[0]);

	Local<Object> opts = info[2]->ToObject();

	if (NanBooleanOptionValue(opts, H("transparent"), false) == TRUE) {
		if (self->transparencySupport == FALSE) {
			g_print("Background cannot be transparent: rgba visual not found and/or webkitgtk >= 2.7.4 required");
		} else {
	#if WEBKIT_CHECK_VERSION(2,7,4)
			static const GdkRGBA transparent = {.0, .0, .0, .0};
			webkit_web_view_set_background_color(self->view, &transparent);
	#endif
		}
	} else {
	#if WEBKIT_CHECK_VERSION(2,7,4)
		static const GdkRGBA opaque = {1.0, 1.0, 1.0, 1.0};
		webkit_web_view_set_background_color(self->view, &opaque);
	#endif
		// nothing to do
	}

	gtk_window_set_decorated(GTK_WINDOW(self->window), NanBooleanOptionValue(opts, H("decorated"), true));

	int w = NanUInt32OptionValue(opts, H("width"), 1024);
	int h = NanUInt32OptionValue(opts, H("height"), 768);
	gtk_window_set_default_size(GTK_WINDOW(self->window), w, h);
	gtk_window_resize(GTK_WINDOW(self->window), w, h);

	const gchar* ua = getStr(opts, "ua");
	if (ua == NULL) {
		ua = "Mozilla/5.0";
	}

	const gchar* charset = getStr(opts, "charset");
	if (charset == NULL) {
		charset = "utf-8";
	}

	WebKitSettings* settings = webkit_web_view_get_settings(self->view);
	g_object_set(settings,
		"default-charset", charset,
		"enable-private-browsing", NanBooleanOptionValue(opts, H("private"), false),
		"enable-plugins", FALSE,
		"print-backgrounds", TRUE,
		"enable-javascript", TRUE,
		"enable-html5-database", FALSE,
		"enable-html5-local-storage", FALSE,
		"enable-java", FALSE,
		"enable-page-cache", FALSE,
		"enable-write-console-messages-to-stdout", FALSE,
		"enable-offline-web-application-cache", FALSE,
		"auto-load-images", NanBooleanOptionValue(opts, H("images"), true),
		"zoom-text-only", FALSE,
		"media-playback-requires-user-gesture", FALSE, // effectively disables media playback ?
		"user-agent", ua, NULL
	);

	self->allowDialogs = NanBooleanOptionValue(opts, H("dialogs"), false);

	if (self->loadCallback != NULL) {
		g_printerr("load callback is still set, this should not happen\n");
		delete self->loadCallback;
	}

	if (self->state == DOCUMENT_LOADED) webkit_web_view_stop_loading(self->view);

	self->loadCallback = loadCb;

	WebKitUserContentManager* contman = webkit_web_view_get_user_content_manager(self->view);

	self->unloaded();

	ViewClosure* vc = new ViewClosure(self, info[1]->IsString() ? **(new Nan::Utf8String(info[1])) : NULL);

	self->signalResourceResponse = g_signal_connect(
		self->view,
		"resource-load-started",
		G_CALLBACK(WebView::ResourceLoad),
		vc
	);

	self->state = DOCUMENT_LOADING;
	self->updateUri(**uri);
	gboolean isEmpty = g_strcmp0(**uri, "") == 0;

	char* script = getStr(opts, "script");
	if (script != NULL) {
		self->userScript = webkit_user_script_new(
			script,
			WEBKIT_USER_CONTENT_INJECT_TOP_FRAME,
			WEBKIT_USER_SCRIPT_INJECT_AT_DOCUMENT_START,
			NULL, NULL
		);
		webkit_user_content_manager_add_script(contman, self->userScript);
		webkit_user_script_unref(self->userScript);
		self->userScript = NULL;
		script = NULL;
	}

	char* style = getStr(opts, "style");
	if (style != NULL) {
		self->userStyleSheet = webkit_user_style_sheet_new(
			style,
			WEBKIT_USER_CONTENT_INJECT_TOP_FRAME,
			WEBKIT_USER_STYLE_LEVEL_USER,
			NULL, NULL
		);
		webkit_user_content_manager_add_style_sheet(contman, self->userStyleSheet);
		webkit_user_style_sheet_unref(self->userStyleSheet);
		self->userStyleSheet = NULL;
		script = NULL;
	}
	char* content = getStr(opts, "content");
	self->waitFinish = NanBooleanOptionValue(opts, H("waitFinish"), FALSE);
	if (isEmpty || content != NULL) {
		self->userContent = TRUE;
		if (content == NULL) content = g_strconcat("", NULL);
		if (isEmpty) {
			g_free(self->uri);
			self->uri = NULL;
		}
		webkit_web_view_load_html(self->view, content, self->uri);
	} else {
		self->userContent = FALSE;
		webkit_web_view_load_uri(self->view, self->uri);
	}
	return;
}

void WebView::RunFinished(GObject* object, GAsyncResult* result, gpointer data) {
	GError* error = NULL;
	ViewClosure* vc = (ViewClosure*)data;
	WebView* self = (WebView*)(vc->view);
	WebKitJavascriptResult* js_result = webkit_web_view_run_javascript_finish(WEBKIT_WEB_VIEW(object), result, &error);
	if (js_result == NULL) { // if NULL, error is defined
		Nan::Utf8String* nStr = (Nan::Utf8String*)(vc->closure);
		Local<Value> argv[] = {
			Nan::Error(error->message),
			Nan::New<String>(**nStr).ToLocalChecked()
		};
		self->eventsCallback->Call(2, argv);
		g_error_free(error);
	} else {
		webkit_javascript_result_unref(js_result);
	}
	delete vc;
}

NAN_METHOD(WebView::Run) {
	Nan::HandleScope scope;
	WebView* self = ObjectWrap::Unwrap<WebView>(info.This());
	if (!info[0]->IsString()) {
		Nan::ThrowError("run(script, ticket) missing script argument");
		return;
	}

	Nan::Utf8String* script = new Nan::Utf8String(info[0]);

	ViewClosure* vc = new ViewClosure(self, new Nan::Utf8String(info[1]));

	if (self->view != NULL) {
		webkit_web_view_run_javascript(
			self->view,
			**script,
			NULL,
			WebView::RunFinished,
			vc
		);
	}
	delete script;
}

void WebView::RunSyncFinished(GObject* object, GAsyncResult* result, gpointer data) {
	GError* error = NULL;
	ViewClosure* vc = (ViewClosure*)data;
	WebView* self = (WebView*)(vc->view);
	WebKitJavascriptResult* js_result = webkit_web_view_run_javascript_finish(WEBKIT_WEB_VIEW(object), result, &error);

	if (js_result == NULL) { // if NULL, error is defined
		Nan::Utf8String* nStr = (Nan::Utf8String*)(vc->closure);
		Local<Value> argv[] = {
			Nan::Error(error->message),
			Nan::New<String>(**nStr).ToLocalChecked()
		};
		self->eventsCallback->Call(2, argv);
		g_error_free(error);
		delete vc;
		return;
	}

	JSGlobalContextRef context = webkit_javascript_result_get_global_context(js_result);
	JSValueRef value = webkit_javascript_result_get_value(js_result);
	gchar* str_value = NULL;
	if (JSValueIsString(context, value)) {
		JSStringRef js_str_value = JSValueToStringCopy(context, value, NULL);
		gsize str_length = JSStringGetMaximumUTF8CStringSize(js_str_value);
		str_value = (gchar*)g_malloc(str_length);
		JSStringGetUTF8CString(js_str_value, str_value, str_length);
		JSStringRelease(js_str_value);
	} else {
		g_warning ("Error running javascript: unexpected return value");
	}
	Local<Value> argv[] = {
		Nan::Null(),
		Nan::New<String>(str_value).ToLocalChecked()
	};
	self->eventsCallback->Call(2, argv);
	if (str_value != NULL) g_free(str_value);
	webkit_javascript_result_unref(js_result);

	delete vc;
}

NAN_METHOD(WebView::RunSync) {
	Nan::HandleScope scope;
	WebView* self = ObjectWrap::Unwrap<WebView>(info.This());
	if (!info[0]->IsString()) {
		Nan::ThrowError("runSync(script, ticket) missing script argument");
		return;
	}
	Nan::Utf8String* script = new Nan::Utf8String(info[0]);
	ViewClosure* vc = new ViewClosure(self, new Nan::Utf8String(info[1]));
	if (self->view != NULL) {
		webkit_web_view_run_javascript(
			self->view,
			**script,
			NULL,
			WebView::RunSyncFinished,
			vc
		);
	}
	delete script;
}

cairo_status_t WebView::PngWrite(void* closure, const unsigned char* data, unsigned int length) {
	WebView* self = (WebView*)closure;

	Nan::MaybeLocal<v8::Object> buff = Nan::CopyBuffer(
		reinterpret_cast<char*>(const_cast<unsigned char*>(data)),
		length
	);
	Local<Value> argv[] = {
		Nan::Null(),
		buff.ToLocalChecked()
	};
	self->pngCallback->Call(2, argv);
	return CAIRO_STATUS_SUCCESS;
}

void WebView::PngFinished(GObject* object, GAsyncResult* result, gpointer data) {
	WebView* self = (WebView*)data;
	GError* error = NULL;
	cairo_surface_t* surface = webkit_web_view_get_snapshot_finish(self->view, result, &error);
	cairo_status_t status = CAIRO_STATUS_SUCCESS;
	if (error == NULL) {
		status = cairo_surface_write_to_png_stream(surface, WebView::PngWrite, data);
	}
	Local<Value> argv[] = {};
	if (status == CAIRO_STATUS_SUCCESS) {
		argv[0] = Nan::Null();
	} else if (error != NULL && error->message != NULL) {
		argv[0] = Nan::Error(error->message);
	} else {
		argv[0] = Nan::Error(cairo_status_to_string(status));
	}
	self->pngCallback->Call(1, argv);
	delete self->pngCallback;
	self->pngCallback = NULL;
}

NAN_METHOD(WebView::Png) {
	Nan::HandleScope scope;
	WebView* self = ObjectWrap::Unwrap<WebView>(info.This());

	if (!info[0]->IsFunction()) {
		Nan::ThrowError("png(cb) missing cb argument");
		return;
	}
	if (self->pngCallback != NULL) {
		Nan::ThrowError("cannot call png(cb) while another call is not yet finished");
		return;
	}
	self->pngCallback = new Nan::Callback(info[0].As<Function>());
	webkit_web_view_get_snapshot(
		self->view,
		WEBKIT_SNAPSHOT_REGION_FULL_DOCUMENT,
		snapshot_options,
		NULL, //	GCancellable
		WebView::PngFinished,
		self
	);
	return;
}

void WebView::PrintFinished(WebKitPrintOperation* op, gpointer data) {
	WebView* self = (WebView*)data;
	if (self->printUri == NULL) return;
	Local<Value> argv[] = {};
	self->printCallback->Call(0, argv);
	delete self->printCallback;
	self->printCallback = NULL;
	delete self->printUri;
	self->printUri = NULL;
}
void WebView::PrintFailed(WebKitPrintOperation* op, gpointer error, gpointer data) {
	WebView* self = (WebView*)data;
	Local<Value> argv[] = {
		Nan::Error(((GError*)error)->message)
	};
	self->printCallback->Call(1, argv);
	delete self->printCallback;
	self->printCallback = NULL;
	delete self->printUri;
	self->printUri = NULL;
}

static gboolean find_file_printer(GtkPrinter* printer, char** data) {
	if (!g_strcmp0(G_OBJECT_TYPE_NAME(gtk_printer_get_backend(printer)), "GtkPrintBackendFile")) {
		*data = strdup(gtk_printer_get_name(printer));
		return TRUE;
	}
	return FALSE;
}

static GtkUnit getUnit(gchar* name) {
	if (g_strcmp0(name, "mm") == 0) {
		return GTK_UNIT_MM;
	} else if (g_strcmp0(name, "in") == 0) {
		return GTK_UNIT_INCH;
	} else {
		return GTK_UNIT_POINTS;
	}
}

NAN_METHOD(WebView::Print) {
	Nan::HandleScope scope;
	WebView* self = ObjectWrap::Unwrap<WebView>(info.This());

	if (self->printUri != NULL) {
		Nan::ThrowError("print() can be executed only one at a time");
		return;
	}
	if (!info[0]->IsString()) {
		Nan::ThrowError("print(filename, opts, cb) missing filename argument");
		return;
	}
	self->printUri = new Nan::Utf8String(info[0]);
	if (!info[2]->IsFunction()) {
		Nan::ThrowError("print(filename, opts, cb) missing cb argument");
		return;
	}
	self->printCallback = new Nan::Callback(info[2].As<Function>());
	Local<Object> opts = info[1]->ToObject();

	WebKitPrintOperation* op = webkit_print_operation_new(self->view);

	GtkPageSetup* setup = gtk_page_setup_new();

	GtkPaperSize* paperSize;
	Local<Value> paperVal = opts->Get(H("paper"));
	if (paperVal->IsString()) {
		paperSize = gtk_paper_size_new(getStr(opts, "paper"));
	} else if (paperVal->IsObject()) {
		Local<Object> paperObj = paperVal->ToObject();
		paperSize = gtk_paper_size_new_custom(
			"custom",
			"custom",
			NanUInt32OptionValue(paperObj, H("width"), 0),
			NanUInt32OptionValue(paperObj, H("height"), 0),
			getUnit(getStr(paperObj, "unit"))
		);
	} else {
		paperSize = gtk_paper_size_new(gtk_paper_size_get_default());
	}

	gtk_page_setup_set_paper_size_and_default_margins(setup, paperSize);

	Local<Value> marginsVal = opts->Get(H("margins"));
	GtkUnit marginUnit = GTK_UNIT_POINTS;
	gdouble defaultMargin = 0;
	Local<Object> marginsObj;
	if (marginsVal->IsNumber()) {
		defaultMargin = marginsVal->NumberValue();
	} else if (marginsVal->IsObject()) {
		marginsObj = marginsVal->ToObject();
	}
	gtk_page_setup_set_left_margin(setup,
		NanUInt32OptionValue(marginsObj, H("left"), defaultMargin),
		marginUnit);
	gtk_page_setup_set_top_margin(setup,
		NanUInt32OptionValue(marginsObj, H("top"), defaultMargin),
		marginUnit);
	gtk_page_setup_set_right_margin(setup,
		NanUInt32OptionValue(marginsObj, H("right"), defaultMargin),
		marginUnit);
	gtk_page_setup_set_bottom_margin(setup,
		NanUInt32OptionValue(marginsObj, H("bottom"), defaultMargin),
		marginUnit);

	webkit_print_operation_set_page_setup(op, setup);

	// settings
	GtkPrintSettings* settings = gtk_print_settings_new();
	GtkPageOrientation orientation = GTK_PAGE_ORIENTATION_PORTRAIT;

	if (g_strcmp0(getStr(opts, "orientation"), "landscape")) {
		orientation = GTK_PAGE_ORIENTATION_LANDSCAPE;
	}
	gtk_print_settings_set_orientation(settings, orientation);
	gtk_print_settings_set_quality(settings, GTK_PRINT_QUALITY_HIGH);

	char* printer = NULL;
	gtk_enumerate_printers((GtkPrinterFunc)find_file_printer, &printer, NULL, TRUE);
	gtk_print_settings_set_printer(settings, printer);
	delete printer;
	gtk_print_settings_set(settings, GTK_PRINT_SETTINGS_OUTPUT_URI, **self->printUri);

	webkit_print_operation_set_print_settings(op, settings);

	// print
	g_signal_connect(op, "failed", G_CALLBACK(WebView::PrintFailed), self);
	g_signal_connect(op, "finished", G_CALLBACK(WebView::PrintFinished), self);
	webkit_print_operation_print(op);
	g_object_unref(op);
	g_object_unref(settings);
	return;
}

NAN_GETTER(WebView::get_prop) {
	Nan::HandleScope scope;
	WebView* self = ObjectWrap::Unwrap<WebView>(info.This());
	std::string propstr = TOSTR(property);

	if (propstr == "uri") {
		if (self->uri != NULL) info.GetReturnValue().Set(Nan::New<String>(self->uri).ToLocalChecked());
		else return;
	} else {
		return;
	}
}

NAN_METHOD(WebView::Inspect) {
	Nan::HandleScope scope;
	WebView* self = ObjectWrap::Unwrap<WebView>(info.This());
	if (self->inspector != NULL) {
		webkit_web_inspector_show(self->inspector);
	}
	return;
}

gboolean WebView::on_new_connection(GDBusServer* server, GDBusConnection* connection, gpointer data) {
	g_object_ref(connection);
	GError* error = NULL;
	guint registration_id = g_dbus_connection_register_object(connection, DBUS_OBJECT_WKGTK,
		introspection_data->interfaces[0], &interface_vtable, data, NULL, &error);
	g_assert(registration_id > 0);
	return TRUE;
}

void WebView::handle_method_call(
GDBusConnection* connection,
const gchar* sender,
const gchar* object_path,
const gchar* interface_name,
const gchar* method_name,
GVariant* parameters,
GDBusMethodInvocation* invocation,
gpointer data) {
	WebView* self = (WebView*)data;
	if (g_strcmp0(method_name, "HandleRequest") == 0) {
		GVariant* variant = g_variant_get_child_value(parameters, 0);
		GVariantDict dict;
		g_variant_dict_init(&dict, variant);
		Local<Object> obj = Nan::New<FunctionTemplate>(GVariantProxy::constructor)->GetFunction()->NewInstance();
		GVariantProxy* prox = node::ObjectWrap::Unwrap<GVariantProxy>(obj);
		prox->init(variant);
		Local<Value> argv[] = {
			obj
		};
		self->requestCallback->Call(1, argv);
		GVariant* tuple[1];
		tuple[0] = g_variant_dict_end(prox->dict);
		g_dbus_method_invocation_return_value(invocation, g_variant_new_tuple(tuple, 1));
	} else if (g_strcmp0(method_name, "NotifyEvent") == 0) {
		g_dbus_method_invocation_return_value(invocation, NULL);
		const gchar* message;
		g_variant_get(parameters, "(&s)", &message);
		Local<Value> argv[] = {
			Nan::Null(),
			Nan::New(message).ToLocalChecked()
		};
		self->eventsCallback->Call(2, argv);
	}
}

void WebView::Exit(void*) {
	uv_timer_stop(&timeout_handle);
	Nan::HandleScope scope;
	for (ObjMap::iterator it = instances.begin(); it != instances.end(); it++) {
		if (it->second != NULL) it->second->destroy();
	}
	instances.clear();
}


NODE_MODULE(webkitgtk, WebView::Init)


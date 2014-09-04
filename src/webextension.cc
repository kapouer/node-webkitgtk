#ifdef ENABLE_WEB_EXTENSION

#include <dbus/dbus-glib.h>
#include <webkit2/webkit-web-extension.h>
#include <JavaScriptCore/JSContextRef.h>
#include <JavaScriptCore/JSStringRef.h>
#include "dbus.h"

static DBusGConnection* connection;
static DBusGProxy* proxy;

static gboolean web_page_send_request(WebKitWebPage* web_page, WebKitURIRequest* request, WebKitURIResponse* redirected_response, gpointer data) {
	GError* error;
	error = NULL;
	const char* uri = webkit_uri_request_get_uri(request);
	char* newuri;
  if (!dbus_g_proxy_call(proxy, "HandleRequest", &error, G_TYPE_STRING, uri, G_TYPE_INVALID, G_TYPE_STRING, &newuri, G_TYPE_INVALID)) {
		if (error->domain == DBUS_GERROR && error->code == DBUS_GERROR_REMOTE_EXCEPTION) {
			g_printerr ("Caught remote method exception %s: %s", dbus_g_error_get_name (error),	error->message);
		}	else {
			g_printerr ("Error: %s\n", error->message);
		}
		g_error_free (error);
		return FALSE;
	}
	g_print("newuri '%s'", newuri);
	if (newuri != NULL && !g_strcmp0(newuri, "")) {
		return TRUE;
	} else if (g_strcmp0(uri, newuri)) {
		webkit_uri_request_set_uri(request, newuri);
	}
	g_free(newuri);
	return FALSE;
}


static void web_page_created_callback(WebKitWebExtension* extension, WebKitWebPage* web_page, gpointer data) {
	g_signal_connect(web_page, "send-request", G_CALLBACK(web_page_send_request), data);
}

/*
static void window_object_cleared_callback(WebKitScriptWorld* world, WebKitWebPage* web_page, WebKitFrame* frame, gpointer user_data) {
	JSGlobalContextRef jsContext;
	JSObjectRef        globalObject;

	jsContext = webkit_frame_get_javascript_context_for_script_world(frame, world);
	globalObject = JSContextGetGlobalObject(jsContext);
  JSEvaluateScript(jsContext, JSStringCreateWithUTF8CString("document.cookie='wont=work'"), NULL, NULL, 1, NULL);
}
*/

extern "C" {
	G_MODULE_EXPORT void webkit_web_extension_initialize_with_user_data(WebKitWebExtension* extension, const GVariant* constData) {
		// constData will be the dbus object number
		// GVariant* data = g_variant_new_string(g_variant_get_string((GVariant*)constData, NULL));
		// note that page-created happens before window-object-cleared
		// g_signal_connect(webkit_script_world_get_default(), "window-object-cleared", G_CALLBACK(window_object_cleared_callback), NULL);

		g_signal_connect(extension, "page-created", G_CALLBACK(web_page_created_callback), NULL);
		GError* error;
		error = NULL;
		connection = dbus_g_bus_get(DBUS_BUS_SESSION, &error);
		if (connection == NULL) {
			g_printerr("Failed to open connection to bus: %s\n", error->message);
      g_error_free(error);
    }
    proxy = dbus_g_proxy_new_for_name(connection, DBUS_NAME_WKGTK, g_variant_get_string((GVariant*)constData, NULL), DBUS_INTERFACE_WKGTK);
    if (proxy == NULL) {
			g_printerr("Failed to get proxy\n");
		}
	}
}

#endif

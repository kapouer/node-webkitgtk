#include <gtk/gtk.h>
#include <webkit2/webkit2.h>
#include <string.h>

const gchar* uri = "http://localhost:3000/lefigaro.fr/1234/read";
const gchar* content = "<!DOCTYPE html>\
<html><head><title bind-text=\"title\"></title><meta http-equiv=\"Content-Type\" content=\"text/html; charset=utf-8\" /><meta http-equiv=\"Content-Script-Type\" content=\"text/javascript; charset=utf-8\" /><link rel=\"stylesheet\" href='/css/live.css' /><script src=\"/js/agent.js\"></script><script src=\"/js/jquery.js\"></script><script src=\"/js/domt.js\"></script><script src=\"/js/window-page.js\"></script><script src=\"/js/moment.js\"></script><script src=\"/js/moment-fr.js\"></script><script src=\"/js/throttle.js\"></script><script src=\"/js/procrastify.js\"></script><script src=\"/js/diffDOM.js\"></script><script src=\"/js/front.js\"></script><link rel=\"import\" href=\"/components/image.html\"><link rel=\"import\" href=\"/components/embed.html\"></head><body><section id=\"live-messages\" class=\"live-messages\" data-page-stage data-lazy-root=\"5\"><meta id=\"opta-customer-id\" content=\"\" /><header class=\"live-header\"><div class=\"live-controls\"><div class=\"filter\"><label class=\"checked\">TOUT LE LIVE</label><label>LES ESSENTIELS</label></div><div class=\"sort\"><label>ORDRE DES POSTS</label></div></div><div class=\"live-status\"><p bind-hidden=\"page|before|drop\" class=\"before\">À VENIR : Début du direct :<time class=\"stamp\" bind-datetime=\"page.start\" bind-text=\"page.start|date\">non précisé</time></p><p bind-hidden=\"page|during|drop\" class=\"during\">EN COURS : Mis à jour<time class=\"stamp\" bind-datetime=\"page.iotime\" bind-text=\"page.iotime|calendar\">il y a 12 minutes</time></p><p bind-hidden=\"page|after|drop\" class=\"after\">TERMINÉ : Fin du direct :<time class=\"stamp\" bind-datetime=\"page.stop\" bind-text=\"page.stop|date\">non précisé</time></p></div></header><article repeat=\"articles|rest\"class=\"live-message\"bind-class=\"live-message [articles.data.articleType]\"><a bind-href=\"#[articles.data.anchor]\" bind-id=\"articles.data.anchor\"><time class=\"live-time\" bind-datetime=\"articles.ctime\" bind-text=\"articles.ctime|calendar\">Non publié</time></a><h3 class=\"live-title\" bind-text=\"articles.title\">Titre</h3><aside class=\"live-icons\" bind-bind=\"articles.components|component\"><img bind-src=\"image.url\" type=\"picto\" where=\"aside\" /></aside><div class=\"live-article\" bind-bind=\"articles.components|component\"><pwhere=\"any\"type=\"text\"bind-html=\"data.content\"></p><component-imagewhere=\"any\"type=\"image\"bind-param-legend=\"data.legend\"bind-param-credit=\"data.credit\"bind-param-position=\"data.position\"bind-param-src=\"image.url\"bind-param-link=\"link.url\"></component-image><component-embedwhere=\"any\"type=\"embed\"bind-param-html=\"embed.meta.html\"></component-embed></div></article></section></body></html>";

WebKitWebView* view;
WebKitSettings* settings;

static void loadWait() {
	g_print("loading new page %s\n", uri);
	webkit_web_view_load_bytes(view, g_bytes_new_take((gpointer)content, strlen(content)), "text/html",
			webkit_settings_get_default_charset(settings), uri);
}

static gboolean reload(gpointer) {
	loadWait();
	return FALSE;
}

static void change(WebKitWebView* view, WebKitLoadEvent load_event, gpointer data) {
	const gchar* uri = webkit_web_view_get_uri(view);
	g_print("page change %s %d \n", uri, load_event);
	if (load_event != WEBKIT_LOAD_FINISHED) return;
	g_timeout_add(150, reload, NULL);
}

int main(int argc, char *argv[]) {
	gtk_init_check(&argc, &argv);
	WebKitWebContext* context = webkit_web_context_get_default();
	webkit_web_context_set_process_model(context, WEBKIT_PROCESS_MODEL_MULTIPLE_SECONDARY_PROCESSES);
	webkit_web_context_set_cache_model(context, WEBKIT_CACHE_MODEL_WEB_BROWSER);
	view = WEBKIT_WEB_VIEW(webkit_web_view_new());
	GtkWidget* window = gtk_offscreen_window_new();
	gtk_container_add(GTK_CONTAINER(window), GTK_WIDGET(view));
	gtk_widget_show_all(window);
	g_signal_connect(view, "load-changed", G_CALLBACK(change), NULL);
	settings = webkit_web_view_get_settings(view);
	g_object_set(settings,
		"enable-plugins", FALSE,
		"enable-javascript", TRUE,
		"enable-page-cache", FALSE,
		"enable-write-console-messages-to-stdout", TRUE,
		NULL
	);
	loadWait();
	gtk_main();
}

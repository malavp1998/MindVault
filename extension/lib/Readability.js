/**
 * Readability.js - Standalone version
 * @license Apache-2.0
 * @see https://github.com/nicjansma/Readability.js
 * 
 * This is a simplified Readability implementation for extracting
 * readable content from web pages.
 */

var Readability = function (doc) {
    this._doc = doc;
};

Readability.prototype = {
    FLAG_STRIP_UNLIKELYS: 0x1,
    FLAG_WEIGHT_CLASSES: 0x2,
    FLAG_CLEAN_CONDITIONALLY: 0x4,

    ELEMENT_NODE: 1,
    TEXT_NODE: 3,

    parse: function () {
        var title = this._getArticleTitle();
        var content = this._grabArticle();

        if (!content) {
            return null;
        }

        var textContent = this._getInnerText(content);

        return {
            title: title,
            content: content.innerHTML,
            textContent: textContent,
            length: textContent.length,
            excerpt: textContent.substring(0, 200)
        };
    },

    _getArticleTitle: function () {
        var doc = this._doc;
        var title = '';

        if (doc.title) {
            title = doc.title.trim();
        }

        // Look for og:title
        var ogTitle = doc.querySelector('meta[property="og:title"]');
        if (ogTitle) {
            title = ogTitle.getAttribute('content') || title;
        }

        return title;
    },

    _grabArticle: function () {
        var doc = this._doc;

        // Try to find article content
        var candidates = [];
        var selectors = ['article', '[role="main"]', 'main', '.post-content', '.article-content', '.entry-content', '#content', '.content'];

        for (var i = 0; i < selectors.length; i++) {
            var el = doc.querySelector(selectors[i]);
            if (el && this._getInnerText(el).length > 100) {
                return el;
            }
        }

        // Fallback: find the element with the most text
        var allElements = doc.querySelectorAll('p, div, section');
        var bestElement = doc.body;
        var bestScore = 0;

        for (var j = 0; j < allElements.length; j++) {
            var el = allElements[j];
            var textLen = this._getInnerText(el).length;
            var paragraphs = el.querySelectorAll('p').length;
            var score = textLen + (paragraphs * 50);

            if (score > bestScore && textLen > 200) {
                bestScore = score;
                bestElement = el;
            }
        }

        return bestElement;
    },

    _getInnerText: function (el) {
        if (!el) return '';
        var text = el.textContent || el.innerText || '';
        // Clean up whitespace
        return text.replace(/\s+/g, ' ').trim();
    }
};

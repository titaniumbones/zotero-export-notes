;;; org-zotero-annots.el --- Insert Zotero annotations as org subtrees -*- lexical-binding: t -*-

;; Author: Matt Price
;; Version: 0.1.0
;; Package-Requires: ((emacs "27.1"))
;; Keywords: org, zotero, annotations, pdf
;; URL: https://github.com/titaniumbones/zotero-export-notes

;;; Commentary:

;; This package fetches PDF annotations from Zotero via the zotero-export-org-notes
;; plugin's HTTP API and inserts them as org-mode subtrees.
;;
;; Requirements:
;; - Zotero 7 with zotero-export-org-notes plugin installed
;; - Better BibTeX (recommended) for citation keys
;;
;; Optional:
;; - citar package for citation key completion from BibTeX library
;;
;; Usage:
;;   M-x org-zotero-annots-insert
;;   M-x org-zotero-annots-insert-at-point
;;
;; Configuration:
;;   (setq org-zotero-annots-port 23119)  ; Zotero HTTP server port
;;   (setq org-zotero-annots-use-citar t) ; Use citar for key selection

;;; Code:

(require 'url)
(require 'json)
(require 'org)

;;; Customization

(defgroup org-zotero-annots nil
  "Insert Zotero annotations as org subtrees."
  :group 'org
  :prefix "org-zotero-annots-")

(defcustom org-zotero-annots-port 23119
  "Port for Zotero HTTP server.
Check Zotero preferences (Advanced > Config Editor) for
`extensions.zotero.httpServer.port' if the default doesn't work."
  :type 'integer
  :group 'org-zotero-annots)

(defcustom org-zotero-annots-use-citar t
  "Use citar for citation key selection when available.
When non-nil and citar is loaded, `citar-select-ref' will be used
for selecting citation keys with completion."
  :type 'boolean
  :group 'org-zotero-annots)

(defcustom org-zotero-annots-timeout 30
  "Timeout in seconds for HTTP requests to Zotero."
  :type 'integer
  :group 'org-zotero-annots)

;;; Internal Functions

(defun org-zotero-annots--fetch (citekey)
  "Fetch annotations for CITEKEY from Zotero API.
Returns a plist with :success, :org, :title, :count, and :error keys."
  (let* ((url-request-method "POST")
         (url-request-extra-headers '(("Content-Type" . "application/json")))
         (url-request-data (json-encode `((key . ,citekey))))
         (url (format "http://localhost:%d/export-org/citekey" org-zotero-annots-port))
         (buffer (condition-case err
                     (url-retrieve-synchronously url nil nil org-zotero-annots-timeout)
                   (error
                    (list :success nil
                          :error (format "Connection failed: %s. Is Zotero running?" (error-message-string err)))))))
    (if (listp buffer)
        buffer  ; Return error plist
      (unwind-protect
          (with-current-buffer buffer
            (goto-char (point-min))
            ;; Skip HTTP headers
            (re-search-forward "^\r?\n" nil t)
            (let* ((json-object-type 'plist)
                   (json-key-type 'keyword)
                   (response (condition-case nil
                                 (json-read)
                               (error nil))))
              (if (and response (plist-get response :success))
                  (list :success t
                        :org (plist-get response :org)
                        :title (plist-get response :title)
                        :count (plist-get response :annotationCount))
                (list :success nil
                      :error (or (plist-get response :error)
                                 "Unknown error from Zotero API")))))
        (kill-buffer buffer)))))

(defun org-zotero-annots--adjust-heading-level (org-text target-level)
  "Adjust heading levels in ORG-TEXT to start at TARGET-LEVEL.
If TARGET-LEVEL is 0 or nil, return ORG-TEXT unchanged.
Otherwise, shift all headings so the top-level becomes TARGET-LEVEL."
  (if (or (null target-level) (zerop target-level))
      org-text
    ;; The org text starts with "* Title" (level 1)
    ;; We need to shift to target-level
    (let ((shift (1- target-level)))  ; How many stars to add
      (if (zerop shift)
          org-text
        (with-temp-buffer
          (insert org-text)
          (goto-char (point-min))
          (while (re-search-forward "^\\(\\*+\\)" nil t)
            (let* ((stars (match-string 1))
                   (new-stars (make-string (+ (length stars) shift) ?*)))
              (replace-match new-stars nil nil nil 1)))
          (buffer-string))))))

(defun org-zotero-annots--read-citekey ()
  "Read citation key, using citar if available and enabled."
  (if (and org-zotero-annots-use-citar
           (fboundp 'citar-select-ref))
      (citar-select-ref)
    (read-string "Citation key: ")))

(defun org-zotero-annots--current-level ()
  "Return the current org heading level, or 0 if not in a heading."
  (or (org-current-level) 0))

(defun org-zotero-annots--insert-content (citekey at-point)
  "Insert annotations for CITEKEY.
If AT-POINT is non-nil, insert at point.
Otherwise, insert at end of current subtree."
  (let ((result (org-zotero-annots--fetch citekey)))
    (if (plist-get result :success)
        (let* ((current-level (org-zotero-annots--current-level))
               (target-level (if (zerop current-level) 1 (1+ current-level)))
               (adjusted-org (org-zotero-annots--adjust-heading-level
                              (plist-get result :org)
                              target-level)))
          ;; Position cursor
          (unless at-point
            (if (zerop current-level)
                (goto-char (point-max))
              (org-end-of-subtree t t)))
          ;; Ensure we're on a new line
          (unless (bolp) (insert "\n"))
          ;; Insert the content
          (insert adjusted-org)
          (unless (bolp) (insert "\n"))
          ;; Report success
          (message "Inserted %d annotations for \"%s\""
                   (plist-get result :count)
                   (plist-get result :title)))
      ;; Report error
      (user-error "Failed to fetch annotations: %s" (plist-get result :error)))))

;;; Interactive Commands

;;;###autoload
(defun org-zotero-annots-insert (citekey)
  "Insert Zotero annotations for CITEKEY at end of current subtree.
If not in a heading, insert at end of buffer as top-level heading.
With citar available, provides completion for citation key selection."
  (interactive (list (org-zotero-annots--read-citekey)))
  (org-zotero-annots--insert-content citekey nil))

;;;###autoload
(defun org-zotero-annots-insert-at-point (citekey)
  "Insert Zotero annotations for CITEKEY at point.
With citar available, provides completion for citation key selection."
  (interactive (list (org-zotero-annots--read-citekey)))
  (org-zotero-annots--insert-content citekey t))

(provide 'org-zotero-annots)
;;; org-zotero-annots.el ends here

//
// Copyright (c) 2010-2012, Peter Jekel
// All rights reserved.
//
//	The Checkbox Tree (cbtree), also known as the 'Dijit Tree with Multi State Checkboxes'
//	is released under to following three licenses:
//
//	1 - BSD 2-Clause							 (http://thejekels.com/js/cbtree/LICENSE)
//	2 - The "New" BSD License			 (http://trac.dojotoolkit.org/browser/dojo/trunk/LICENSE#L13)
//	3 - The Academic Free License	 (http://trac.dojotoolkit.org/browser/dojo/trunk/LICENSE#L43)
//
//	In case of doubt, the BSD 2-Clause license takes precedence.
//
define([
	"dojo/_base/array", // array.indexOf array.some
	"dojo/_base/declare", // declare
	"dojo/_base/lang", // lang.hitch
	"dojo/_base/window", // win.global
	"./TreeStoreModel"
], function(array, declare, lang, win, TreeStoreModel){

		// module:
		//		cbtree/models/ForestStoreModel
		// summary:
		//		Interface between a CheckBox Tree and a dojo.data store that doesn't have a 
		//		root item, a.k.a. a store that has multiple "top level" items.

	return declare([TreeStoreModel], {
		// summary:
		//		Interface between a cbTree.Tree and a dojo.data store that doesn't have a root item,
		//		a.k.a. a store that has multiple "top level" items.
		//
		// description
		//		Use this class to wrap a dojo.data store, making all the items matching the specified query
		//		appear as children of a fabricated "root item".  If no query is specified then all the
		//		items returned by fetch() on the underlying store become children of the root item.
		//		This class allows cbTree.Tree to assume a single root item, even if the store doesn't have one.

		//=================================
		// Parameters to constructor

		// rootLabel: String
		//		Label of fabricated root item
		rootLabel: "ROOT",

		// rootId: String
		//		ID of fabricated root item
		rootId: "$root$",

		// End of parameters to constructor
		//=================================
		
		moduleName: "cbTree/ForestStoreModel",

		constructor: function (params) {
			// summary:
			//		Sets up variables, etc.
			// tags:
			//		private

			// Make dummy root item
			this.root = {
				store: this,
				root: true,
				id: this.rootId,
				label: this.rootLabel,
				children: params.rootChildren	// optional param
			};
			this.root[this.checkedAttr] = this.checkedState;
			this.hasFakeRoot = true;
		},

		// =======================================================================
		// Methods for traversing hierarchy

		mayHaveChildren: function(/*dojo.data.Item*/ item){
			// summary:
			//		Tells if an item has or may have children.  Implementing logic here
			//		avoids showing +/- expando icon for nodes that we know don't have children.
			//		(For efficiency reasons we may not want to check if an element actually
			//		has children until user clicks the expando node)
			// tags:
			//		extension
			return item === this.root || this.inherited(arguments);
		},

		getChildren: function(/*dojo.data.Item*/ parentItem, /*function(items)*/ callback, /*function*/ onError){
			// summary:
			// 		Calls onComplete() with array of child items of given parent item, all loaded.
			if(parentItem === this.root){
				if(this.root.children){
					// already loaded, just return
					callback(this.root.children);
				}else{
					this.store.fetch({
						query: this.query,
						onComplete: lang.hitch(this, function(items){
							this.root.children = items;
							callback(items);
						}),
						onError: onError
					});
				}
			}else{
				this.inherited(arguments);
			}
		},

		// =======================================================================
		// Inspecting items

		isItem: function(/* anything */ something){
			return (something === this.root) ? true : this.inherited(arguments);
		},

		fetchItemByIdentity: function(/* object */ keywordArgs){
			if(keywordArgs.identity == this.root.id){
				var scope = keywordArgs.scope?keywordArgs.scope:win.global;
				if(keywordArgs.onItem){
					keywordArgs.onItem.call(scope, this.root);
				}
			}else{
				this.inherited(arguments);
			}
		},

		getIdentity: function(/* item */ item){
			return (item === this.root) ? this.root.id : this.inherited(arguments);
		},

		getLabel: function(/* item */ item){
			return	(item === this.root) ? this.root.label : this.inherited(arguments);
		},

		// =======================================================================
		// Write interface

		newItem: function(/* dojo.dnd.Item */ args, /*Item*/ parent, /*int?*/ insertIndex){
			// summary:
			//		Creates a new item.   See dojo.data.api.Write for details on args.
			//		Used in drag & drop when item from external source dropped onto tree.
			if(parent === this.root){
				var newItem = this.store.newItem(args);
				this._updateCheckedParent(newItem);
				return newItem;
			}else{
				return this.inherited(arguments);
			}
		},

		pasteItem: function (/*dojo.data.item*/ childItem, /*dojo.data.item*/ oldParentItem, /*dojo.data.item*/ newParentItem, 
												 /*Boolean*/ bCopy, /*int?*/ insertIndex){
			// summary:
			//		Move or copy an item from one parent item to another.
			//		Used in drag & drop
			// tags:
			//		extension

			if (oldParentItem === this.root){
				if (!bCopy){
					// It's onLeaveRoot()'s responsibility to modify the item so it no longer matches
					// this.query... thus triggering an onChildrenChange() event to notify the Tree
					// that this element is no longer a child of the root node
					this.store.detachFromRoot(childItem);
				}
			}
			this.inherited(arguments, [childItem,
				oldParentItem === this.root ? null : oldParentItem,
				newParentItem === this.root ? null : newParentItem,
				bCopy,
				insertIndex
			]);
			this._updateCheckedParent(childItem);
		},

		// =======================================================================
		// Events from data store

		onDeleteItem: function(/*Object*/ item){
			// summary:
			//		Handler for delete notifications from underlying store

			// check if this was a child of root, and if so send notification that root's children
			// have changed
			if(array.indexOf(this.root.children, item) != -1){
				this._requeryTop();
			}
			this.inherited(arguments);
		},

		onSetItem: function (/*dojo.data.item*/ storeItem, /*string*/ attribute, /*AnyType*/ oldValue, 
												  /*AnyType*/ newValue){
			// summary:
			//		Updates the tree view according to changes in the data store.
			// description:
			//		Handles updates to a store item's children by calling onChildrenChange(), and
			//		other updates to a store item by calling onChange().
			// storeItem: 
			//		Store item
			// attribute: 
			//		attribute-name-string
			// oldValue:
			//		Old attribute value
			// newValue:
			//		New attribute value.
			// tags:
			//		extension

			if (this._queryAttrs.length && array.indexOf(this._queryAttrs, attribute) != -1) {
				this._requeryTop();
			}
			this.inherited(arguments);
		},

		onRootChange: function (/*dojo.data.item*/ storeItem, /*Object*/ evt) {
			// summary:
			//		Handler for any changes to the stores top level items.
			// description:
			//		Users can extend this method to modify a new element that's being
			//		added to the root of the tree, for example to make sure the new item
			//		matches the tree root query. Remember, even though the item is added
			//		as a top level item in the store it does not quarentee it will match
			//		your tree query unless your query is simply the store identifier.
			//		Therefore, in case of a store root detach event (evt.detach=true) we
			//		only require if the item is a known child of the tree root.
			// storeItem:
			//		The store item that was attached to, or detached from, the root.
			// evt:
			//		Object detailing the type of event { attach: boolean, detach: boolean }.
			// tag:
			//		callback, public

			if (evt.attach || (array.indexOf(this.root.children, storeItem) != -1)){
				this._requeryTop();
			}
		},
		
		_requeryTop: function (){
			// summary:
			//		Reruns the query for the children of the root node, sending out an
			//		onChildrenChange notification if those children have changed.
			// tags:
			//		private

			var oldChildren = this.root.children || [];
			this.store.fetch({
				query: this.query,
				onComplete: lang.hitch(this, function (newChildren){
					this.root.children = newChildren;
					// If the list of children or the order of children has changed...
					if (oldChildren.length != newChildren.length ||
						array.some(oldChildren, function (item, idx){ 
								return newChildren[idx] != item;
							})) {
						this.onChildrenChange(this.root, newChildren);
						this._updateCheckedParent(newChildren[0]);
					}
				}) /* end hitch() */
			}); /* end fetch() */
		}

	});

});

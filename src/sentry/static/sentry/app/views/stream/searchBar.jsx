import React from "react";
import Reflux from "reflux";
import _ from "underscore";

// import TagStore from "../../stores/tagStore";
import MemberListStore from "../../stores/memberListStore";

import api from "../../api";

var PureRenderMixin = require('react/addons').addons.PureRenderMixin;

import SearchDropdown from "./searchDropdown";

var SearchBar = React.createClass({
  contextTypes: {
    router: React.PropTypes.func
  },

  mixins: [
    PureRenderMixin,
    Reflux.listenTo(MemberListStore, 'onMemberListStoreChange')
  ],

  DROPDOWN_BLUR_DURATION: 200,

  getDefaultProps() {
    return {
      defaultQuery: "",
      query: "",
      onSearch: function() {},
      onQueryChange: function() {},

      defaultSearchItems: [
        {
          title: 'Tag',
          desc: 'key/value pair associated to an event',
          example: 'browser:"Chrome 34"',
          className: 'icon-tag',
          value: 'browser:'
        },
        {
          title: 'Status',
          desc: 'State of an event',
          example: 'is:resolved, unresolved, muted',
          className: 'icon-toggle',
          value: 'is:'
        },
        {
          title: 'Assigned',
          desc: 'team member assigned to an event',
          example: 'assigned:[me|user@example.com]',
          className: 'icon-user',
          value: 'assigned:'
        },
        {
          desc: 'or paste an event id to jump straight to it',
          className: 'icon-hash',
          value: ''
        }
      ]
    };
  },

  getInitialState() {
    return {
      query: this.props.query || this.props.defaultQuery,

      searchTerm: '',
      searchItems: [],
      activeSearchItem: 0,

      tags: {},
      members: MemberListStore.getAll(),

      dropdownVisible: false,
      loading: false
    };
  },

  componentWillMount() {
    var params = this.context.router.getCurrentParams();
    api.request(`/projects/${params.orgId}/${params.projectId}/tags/`, {
      success: (tags) => {
        this.setState({
          tags: tags.reduce((obj, tag) => {
            obj[tag.key] = tag;
            return obj;
          }, this.state.tags)
        });
      }
    });
  },

  statics: {
    /**
     * Given a query, and the current cursor position, return the string-delimiting
     * index of the search term designated by the cursor.
     */
    getLastTermIndex(query, cursor) {
      // TODO: work with quoted-terms
      let cursorOffset = query.slice(cursor).search(/\s|$/);
      return cursor + (cursorOffset === -1 ? 0 : cursorOffset);
    },

    /**
     * Returns an array of query terms, including incomplete terms
     *
     * e.g. ["is:unassigned", "browser:\"Chrome 33.0\"", "assigned"]
     */
    getQueryTerms(query, cursor) {
      return query.slice(0, cursor).match(/\S+:"[^"]*"?|\S+/g);
    }
  },

  blur() {
    this.refs.searchInput.getDOMNode().blur();
  },

  onSubmit(evt) {
    evt.preventDefault();
    this.blur();
    this.props.onSearch(this.state.query);
  },

  clearSearch() {
    this.setState(
      { query: this.props.defaultQuery },
      () => this.props.onSearch(this.state.query)
    );
  },

  onQueryFocus() {
    this.setState({
      dropdownVisible: true
    });
  },

  onQueryBlur() {
    // wait 200ms before closing dropdown in case blur was a result of
    // clicking a menu option
    this.blurTimeout = setTimeout(() => {
      this.blurTimeout = null;
      this.setState({ dropdownVisible: false });
    }, this.DROPDOWN_BLUR_DURATION);
  },

  onQueryChange(evt) {
    this.setState(
      { query: evt.target.value },
      () => this.updateAutoCompleteItems()
    );
  },

  onKeyUp(evt) {
    if (evt.key === 'Escape' || evt.keyCode === 27) {
      // blur handler should additionally hide dropdown
      this.blur();
    }
  },

  getCursorPosition() {
    return this.refs.searchInput.getDOMNode().selectionStart;
  },

  /**
   * Returns a tag object matching the given tag name. Includes
   * predefined tags (e..g "is:" and "assigned:").
   */
  getTag(tagName) {
    // predefined search terms tag priority over tags
    switch (tagName) {
      case 'is':
        return {
          key: 'is',
          values: [
            { value: 'resolved' },
            { value: 'unresolved' },
            { value: 'muted' }
          ],
          predefined: true
        };
      case 'assigned':
        return {
          key: 'assigned',
          values: MemberListStore.getAll().map(user => {
            return { value: user.email };
          }),
          predefined: true
        };
      default:
        return this.state.tags[tagName];
    }
  },

  /**
   * Returns array of possible key values that substring match `query`
   *
   * e.g. ['is:', 'assigned:', 'url:', 'release:']
   */
  getTagKeys: function (query) {
    let keys = [
      'is',
      'assigned'
    ].concat(Object.keys(this.state.tags).map(k => this.state.tags[k].key));

    return keys
      .map(key => key + ':')
      .filter(key => key.indexOf(query) > -1);
  },

  /**
   * Returns array of tag values that substring match `query`; invokes `callback`
   * with data when ready
   */
  getTagValues: _.debounce(function (tag, query, callback) {
    // Strip double quotes if there are any
    query = query.replace('"', '').trim();

    this.setState({
      loading: true
    });

    var params = this.context.router.getCurrentParams();
    api.request(`/projects/${params.orgId}/${params.projectId}/tags/${tag.key}/values/`, {
      data: {
        query: query
      },
      method: "GET",
      success: (values) => {
        this.setState({ loading: false });
        callback(values.map(v => '"' + v.value + '"'), tag.key, query);
      }
    });
  }, 300),

  /**
   * Returns array of tag values that substring match `query`; invokes `callback`
   * with results
   */
  getPredefinedTagValues: function (tag, query, callback) {
    var values = tag.values
      .map(valueObj => valueObj.value)
      .filter(value => value.indexOf(query) > -1);

    callback(values, tag.key);
  },

  onInputClick() {
    let cursor = this.getCursorPosition();

    if (cursor === this.state.query.length && this.state.query.charAt(cursor - 1) !== ' ') {
      // If the cursor lands at the end of the input value, and the preceding character
      // is not whitespace, then add a space and move the cursor beyond that space.
      this.setState(
        { query: this.state.query + ' ' },
        () => {
          this.refs.searchInput.getDOMNode().setSelectionRange(cursor + 1, cursor + 1);
          this.updateAutoCompleteItems();
        }
      );
    } else {
      this.updateAutoCompleteItems();
    }
  },

  updateAutoCompleteItems() {
    if (this.blurTimeout) {
      clearTimeout(this.blurTimeout);
      this.blurTimeout = null;
    }

    var cursor = this.getCursorPosition();
    var query = this.state.query;

    let lastTermIndex = SearchBar.getLastTermIndex(query, cursor);
    let terms = SearchBar.getQueryTerms(query.slice(0, lastTermIndex));

    if (!terms || // no terms
        terms.length === 0 || // no terms
        terms.length === 1 && terms[0] === this.props.defaultQuery || // default term
        /\s{2}|\s{1}/.test(query.slice(cursor - 1, cursor + 1))) // cursor on whitespace
    {
      // show default "help" search terms
      return void this.setState({
        searchTerm: '',
        searchItems: this.props.defaultSearchItems,
        activeSearchItem: 0
      });
    }

    let last = terms.pop();
    let autoCompleteItems;
    let matchValue;
    let tagName;
    let index = last.indexOf(':');

    if (index === -1) {
      // No colon present; must still be deciding key
      matchValue = last;
      autoCompleteItems = this.getTagKeys(matchValue);

      this.setState({searchTerm: matchValue});
      this.updateAutoCompleteState(autoCompleteItems, matchValue);
    } else {
      tagName = last.slice(0, index);
      query = last.slice(index + 1);
      this.setState({searchTerm: query});

      let tag = this.getTag(tagName);
      if (!tag)
        return void this.setState({
          searchItems: []
        });

      return void (
        tag.predefined
          ? this.getPredefinedTagValues
          : this.getTagValues
        )(tag, query, this.updateAutoCompleteState);
    }
  },

  isDefaultDropdown() {
    return this.state.searchItems === this.props.defaultSearchItems;
  },

  updateAutoCompleteState(autoCompleteItems, tagName) {
    autoCompleteItems = autoCompleteItems.map(item => {
      let out = {
        desc: item,
        value: item,
      };

      // Specify icons according to tag value
      switch (tagName || item.replace(':', '')) {
        case 'is':
          out.className = 'icon-toggle';
          break;
        case 'assigned':
          out.className = 'icon-user';
          break;
        default:
          out.className = 'icon-tag';
      }
      return out;
    });

    if (autoCompleteItems.length > 0 && !this.isDefaultDropdown()) {
      autoCompleteItems[0].active = true;
    }

    this.setState({
      searchItems: autoCompleteItems.slice(0, 5), // only show 5
      activeSearchItem: 0
    });
  },

  onKeyDown(evt) {
    let state = this.state;
    let searchItems = state.searchItems;

    if (!searchItems.length)
      return;

    if (evt.key === 'ArrowDown' || evt.key === 'ArrowUp') {
      evt.preventDefault();

      // Move active selection up/down
      delete searchItems[state.activeSearchItem].active;

      state.activeSearchItem = evt.key === 'ArrowDown'
        ? Math.min(state.activeSearchItem + 1, searchItems.length - 1)
        : Math.max(state.activeSearchItem - 1, 0);

      searchItems[state.activeSearchItem].active = true;
      this.setState({ searchItems: searchItems.slice(0) });

    } else if ((evt.key === 'Tab' || evt.key === 'Enter') && !this.isDefaultDropdown()) {
      evt.preventDefault();

      this.onAutoComplete(searchItems[state.activeSearchItem].value);
    }
  },

  onAutoComplete(replaceText) {
    let cursor = this.getCursorPosition();
    let query = this.state.query;

    let lastTermIndex = SearchBar.getLastTermIndex(query, cursor);
    let terms = SearchBar.getQueryTerms(query.slice(0, lastTermIndex));
    let newQuery;

    // If not postfixed with : (tag value), add trailing space
    replaceText += replaceText.charAt(replaceText.length - 1) === ':' ? '' : ' ';

    if (!terms) {
      newQuery = replaceText;
    } else {
      let last = terms.pop();

      newQuery = query.slice(0, lastTermIndex); // get text preceding last term

      newQuery = last.indexOf(':') > -1
        // tag key present: replace everything after colon with replaceText
        ? newQuery.replace(/\:"[^"]*"?$|\:\S*$/, ':' + replaceText)
        // no tag key present: replace last token with replaceText
        : newQuery.replace(/\S+$/, replaceText);

      newQuery = newQuery.concat(query.slice(lastTermIndex));
    }

    this.setState({
      query: newQuery
    }, () => {
      // setting a new input value will lose focus; restore it
      var node = this.refs.searchInput.getDOMNode();
      node.focus();

      // then update the autocomplete box with new contextTypes
      this.updateAutoCompleteItems();
    });
  },

  onMemberListStoreChange(members) {
    this.setState({
      members: members
    }, this.updateAutoCompleteItems);
  },

  render() {
    var dropdownStyle = {
      display: this.state.dropdownVisible ? 'block' : 'none'
    };

    return (
      <div className="search">
        <form className="form-horizontal" ref="searchForm" onSubmit={this.onSubmit}>
          <div>
            <input type="text" className="search-input form-control"
              placeholder={this.props.placeholder}
              name="query"
              ref="searchInput"
              autoComplete="off"
              value={this.state.query}
              onFocus={this.onQueryFocus}
              onBlur={this.onQueryBlur}
              onKeyUp={this.onKeyUp}
              onKeyDown={this.onKeyDown}
              onChange={this.onQueryChange}
              onClick={this.onInputClick}
              />
            <span className="icon-search" />
            {this.state.query !== this.props.defaultQuery &&
              <div>
                <a className="search-clear-form" onClick={this.clearSearch}>
                  <span className="icon-circle-cross" />
                </a>
              </div>
            }
          </div>

          {(this.state.loading || this.state.searchItems.length > 0) &&
            <div style={dropdownStyle}>
              <SearchDropdown
                style={dropdownStyle}
                items={this.state.searchItems}
                onClick={this.onAutoComplete}
                loading={this.state.loading}
                searchSubstring={this.state.searchTerm}
                />
            </div>
          }
        </form>
      </div>
    );
  }
});

export default SearchBar;

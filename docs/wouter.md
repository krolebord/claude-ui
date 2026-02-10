### Installing Wouter using pnpm

Source: https://github.com/molefrog/wouter/blob/v3/README.md

This command shows how to install the wouter package using the pnpm package manager. This is the first step to using wouter in a React project.

```bash
pnpm add wouter
```

--------------------------------

### Router Component with Base Path Example

Source: https://github.com/molefrog/wouter/blob/v3/README.md

Illustrates how to specify a base path using the `Router` component. This allows the app to be deployed to a subfolder without modifying the route definitions. The example shows how to use the `base` prop and how links are affected.

```javascript
import { Router, Route, Link } from "wouter";

const App = () => (
  <Router base="/app">
    {/* the link's href attribute will be "/app/users" */}
    <Link href="/users">Users</Link>

    <Route path="/users">The current path is /app/users!</Route>
  </Router>
);
```

--------------------------------

### Route Nesting Example

Source: https://github.com/molefrog/wouter/blob/v3/README.md

Demonstrates how to use the `nest` prop to create nested routing contexts in wouter.  This allows for matching paths that start with a given pattern, with child routes receiving location relative to that pattern. The example shows a three-level route structure.

```javascript
<Route path="/app" nest>
  <Route path="/users/:id" nest>
    <Route path="/orders" />
  </Route>
</Route>
```

--------------------------------

### Redirect Component Example

Source: https://github.com/molefrog/wouter/blob/v3/README.md

Illustrates the usage of the `Redirect` component to perform a redirect to a specified path. It shows how to use the `to` prop for setting the target path and how to pass additional navigation parameters such as state and `replace`.

```jsx
<Redirect to="/" />

// arbitrary state object
<Redirect to="/" state={{ modal: true }} />

// use `replaceState`
<Redirect to="/" replace />
```

--------------------------------

### Router Component Example

Source: https://github.com/molefrog/wouter/blob/v3/README.md

Demonstrates how to use the `Router` component to customize routing behavior, such as using hash-based routing or specifying a base path.  It shows how to provide a custom location hook and base path.

```jsx
import { useHashLocation } from "wouter/use-hash-location";

<Router hook={useHashLocation} base="/app">
  {/* Your app goes here */}
</Router>;
```

--------------------------------

### Using useRoute with Wildcards in Wouter

Source: https://github.com/molefrog/wouter/blob/v3/README.md

This example shows how to use wildcards with the `useRoute` hook to match a range of URLs. It demonstrates how to access the wildcard parameter using the `"*"` key in the `params` object.

```javascript
// wildcards, matches "/app", "/app-1", "/app/home"
const [match, params] = useRoute("/app*");

if (match) {
  // "/home" for "/app/home"
  const page = params["*"];
}
```

--------------------------------

### Link Component Example

Source: https://github.com/molefrog/wouter/blob/v3/README.md

Illustrates the usage of the `Link` component in wouter to create navigation links.  It shows how to use `href` and `to` props for specifying the target path, standard `a` props for styling, and location hook options for customizing navigation behavior.

```javascript
import { Link } from "wouter"

<Link href="/">Home</Link>

// `to` is an alias for `href`
<Link to="/">Home</Link>

// all standard `a` props are proxied
<Link href="/" className="link" aria-label="Go to homepage">Home</Link>

// all location hook options are supported
<Link href="/" replace state={{ animate: true }} />
```

--------------------------------

### Switch Component Example

Source: https://github.com/molefrog/wouter/blob/v3/README.md

Demonstrates how to use the `Switch` component to implement exclusive routing, ensuring that only the first matching route is rendered.  It also illustrates how to create a default route using a `Route` with an empty path.

```javascript
import { Route, Switch } from "wouter";

<Switch>
  <Route path="/orders/all" component={AllOrders} />
  <Route path="/orders/:status" component={Orders} />

  {/* 
     in wouter, any Route with empty path is considered always active. 
     This can be used to achieve "default" route behaviour within Switch. 
     Note: the order matters! See examples below.
  */}
  <Route>This is rendered when nothing above has matched</Route>
</Switch>;
```

--------------------------------

### Basic Routing Example using Wouter in React

Source: https://github.com/molefrog/wouter/blob/v3/README.md

This code demonstrates basic routing functionality using wouter components such as Link, Route, and Switch. It defines a simple app with navigation links, route definitions, and a fallback 404 route. It shows how to define routes with parameters.

```javascript
import { Link, Route, Switch } from "wouter";

const App = () => (
  <>
    <Link href="/users/1">Profile</Link>

    <Route path="/about">About Us</Route>

    {/* 
      Routes below are matched exclusively -
      the first matched route gets rendered
    */}
    <Switch>
      <Route path="/inbox" component={InboxPage} />

      <Route path="/users/:name">
        {(params) => <>Hello, {params.name}!</>}
      </Route>

      {/* Default route in a switch */}
      <Route>404: No such page!</Route>
    </Switch>
  </>
);

```

--------------------------------

### Examples of useRoute Patterns in Wouter

Source: https://github.com/molefrog/wouter/blob/v3/README.md

This snippet showcases various pattern matching options available with `useRoute`, including optional parameters, suffixes, wildcards, optional wildcards, and regular expressions. It illustrates the flexibility of route definitions in Wouter.

```javascript
useRoute("/app/:page");
useRoute("/app/:page/:section");

// optional parameter, matches "/en/home" and "/home"
useRoute("/:locale?/home");

// suffixes
useRoute("/movies/:title.(mp4|mov)");

// wildcards, matches "/app", "/app-1", "/app/home"
useRoute("/app*");

// optional wildcards, matches "/orders", "/orders/"
// and "/orders/completed/list"
useRoute("/orders/*?");

// regex for matching complex patterns,
// matches "/hello:123"
useRoute(/^[/]([a-z]+):([0-9]+)[/]?$/);
// and with named capture groups
useRoute(/^[/](?<word>[a-z]+):(?<num>[0-9]+)[/]?$/);
```

--------------------------------

### Route Component Usage Examples

Source: https://github.com/molefrog/wouter/blob/v3/README.md

This snippet demonstrates different ways to use the `Route` component in Wouter to conditionally render content based on the current path. It showcases simple form, render-prop style, and the `component` prop.

```javascript
import { Route } from "wouter";

// simple form
<Route path="/home"><Home /></Route>

// render-prop style
<Route path="/users/:id">
  {params => <UserPage id={params.id} />}
</Route>

// the `params` prop will be passed down to <Orders />
<Route path="/orders/:status" component={Orders} />
```

--------------------------------

### Using useRouter Hook in Wouter

Source: https://github.com/molefrog/wouter/blob/v3/README.md

This example demonstrates how to access the global router object using the `useRouter` hook. The router object contains routing options configured in the `Router` component, such as the location hook and base path.

```javascript
import { useRouter } from "wouter";

const Custom = () => {
  const router = useRouter();

  router.hook; // `useBrowserLocation` by default
  router.base; // "/app"
};

const App = () => (
  <Router base="/app">
    <Custom />
  </Router>
);
```

--------------------------------

### Using useSearch Hook in Wouter

Source: https://github.com/molefrog/wouter/blob/v3/README.md

This example shows how to use the `useSearch` hook to get the current search string. The component will re-render when the search string updates. The returned string does not include the `?` character.

```jsx
import { useSearch } from "wouter";

// returns "tab=settings&id=1"
const searchString = useSearch();
```

--------------------------------

### Using useRoute Hook in Wouter

Source: https://github.com/molefrog/wouter/blob/v3/README.md

This example demonstrates how to use the `useRoute` hook to check if the current location matches a specified route pattern and extract parameters. It shows conditional rendering based on the route match and access to route parameters.

```javascript
import { useRoute } from "wouter";

const Users = () => {
  // `match` is a boolean
  const [match, params] = useRoute("/users/:name");

  if (match) {
    return <>Hello, {params.name}!</>;
  } else {
    return null;
  }
};
```

--------------------------------

### Using useParams Hook in Wouter

Source: https://github.com/molefrog/wouter/blob/v3/README.md

This example demonstrates how to use the `useParams` hook to access route parameters within a component rendered by a `Route`.  It retrieves parameters from the closest parent route, avoiding prop drilling.

```javascript
import { Route, useParams } from "wouter";

const User = () => {
  const params = useParams();

  params.id; // "1"

  // alternatively, use the index to access the prop
  params[0]; // "1"
};

<Route path="/user/:id" component={User}> </Route>
```

--------------------------------

### Using useLocation Hook in Wouter

Source: https://github.com/molefrog/wouter/blob/v3/README.md

This snippet illustrates how to use the `useLocation` hook to get the current location and a function to navigate to different pages. It's analogous to `useState`, triggering re-renders upon location changes.

```javascript
import { useLocation } from "wouter";

const CurrentLocation = () => {
  const [location, navigate] = useLocation();

  return (
    <div>
      {`The current page is: ${location}`}
      <a onClick={() => navigate("/somewhere")}>Click to update</a>
    </div>
  );
};
```

--------------------------------

### Additional Navigation Parameters with useLocation

Source: https://github.com/molefrog/wouter/blob/v3/README.md

This example shows how to use additional navigation parameters with the `useLocation` hook, specifically the `replace` and `state` options.  The `replace` option modifies the current history entry, and the `state` option updates the history state.

```jsx
const [location, navigate] = useLocation();

navigate("/jobs"); // `pushState` is used
navigate("/home", { replace: true }); // `replaceState` is used
```

```jsx
navigate("/home", { state: { modal: "promo" } });

history.state; // { modal: "promo" }
```

--------------------------------

### Using useSearchParams Hook in Wouter

Source: https://github.com/molefrog/wouter/blob/v3/README.md

This code shows how to use the `useSearchParams` hook to get and set search parameters using a `URLSearchParams` object.  It demonstrates how to extract, modify, and override search parameters, and how to use the `replace` and `state` options to control history updates.

```jsx
import { useSearchParams } from 'wouter';

const [searchParams, setSearchParams] = useSearchParams();

// extract a specific search parameter
const id = searchParams.get('id');

// modify a specific search parameter
setSearchParams((prev) => {
  prev.set('tab', 'settings');
});

// override all search parameters
setSearchParams({
  id: 1234,
  tab: 'settings',
});

// by default, setSearchParams() will push a new history entry
// to avoid this, set `replace` option to `true`
setSearchParams(
  (prev) => {
    prev.set('order', 'desc');
  },
  {
    replace: true,
  },
);

// you can also pass a history state in options
setSearchParams(
  (prev) => {
    prev.set('foo', 'bar');
  },
  {
    state: 'hello',
  },
);
```

--------------------------------

### Navigating Programmatically with navigate - JS

Source: https://github.com/molefrog/wouter/blob/v3/README.md

This snippet demonstrates how to initiate navigation from outside a component using the `navigate` function from the `wouter/use-browser-location` module. This function is the same one used internally by wouter.

```js
import { navigate } from "wouter/use-browser-location";

navigate("/", { replace: true });
```

--------------------------------

### Nested Routers with Base Paths

Source: https://github.com/molefrog/wouter/blob/v3/README.md

Demonstrates how base paths are inherited and stack up when using multiple nested `Router` components. This allows for creating modular routing structures with different base paths for different sections of the application.

```javascript
<Router base="/app">
  <Router base="/cms">
    <Route path="/users">Path is /app/cms/users!</Route>
  </Router>
</Router>
```

--------------------------------

### Using wouter with Preact - DIFF

Source: https://github.com/molefrog/wouter/blob/v3/README.md

This snippet shows how to import wouter components when using Preact.  It recommends using the `wouter-preact` package instead of importing from `wouter/preact` directly.

```diff
- import { useRoute, Route, Switch } from "wouter";
+ import { useRoute, Route, Switch } from "wouter-preact";
```

--------------------------------

### Server-Side Rendering (SSR) with wouter - JS

Source: https://github.com/molefrog/wouter/blob/v3/README.md

This snippet demonstrates how to use wouter for server-side rendering. It wraps the application with the top-level `<Router>` component and specifies the `ssrPath` and optionally `ssrSearch` props derived from the request.  It also covers hydrating the client.

```js
import { renderToString } from "react-dom/server";
import { Router } from "wouter";

const handleRequest = (req, res) => {
  // top-level Router is mandatory in SSR mode
  // pass an optional context object to handle redirects on the server
  const ssrContext = {};
  const prerendered = renderToString(
    <Router ssrPath={req.path} ssrSearch={req.search} ssrContext={ssrContext}>
      <App />
    </Router>
  );

  if (ssrContext.redirectTo) {
    // encountered redirect
    res.redirect(ssrContext.redirectTo);
  } else {
    // respond with prerendered html
  }
};
```

```jsx
<Router ssrPath="/goods?sort=asc" />;
```

```jsx
<Router ssrPath="/goods" ssrSearch="sort=asc" />;
```

```js
import { hydrateRoot } from "react-dom/client";

const root = hydrateRoot(
  domNode,
  // during hydration, `ssrPath` is set to `location.pathname`,
  // `ssrSearch` set to `location.search` accordingly
  // so there is no need to explicitly specify them
  <Router>
    <App />
  </Router>
);
```

--------------------------------

### Custom Parser with pathToRegexp for Strict Routes - JS

Source: https://github.com/molefrog/wouter/blob/v3/README.md

This snippet demonstrates how to implement strict route matching using a custom parser based on the `path-to-regexp` library.  The parser is passed to the `<Router>` component. It configures the `pathToRegexp` function with `strict: true` to enforce trailing slashes.

```js
import { pathToRegexp } from "path-to-regexp";

/**
 * Custom parser based on `pathToRegexp` with strict route option
 */
const strictParser = (path, loose) => {
  const keys = [];
  const pattern = pathToRegexp(path, keys, { strict: true, end: !loose });

  return {
    pattern,
    // `pathToRegexp` returns some metadata about the keys,
    // we want to strip it to just an array of keys
    keys: keys.map((k) => k.name),
  };
};

const App = () => (
  <Router parser={strictParser}>
    <Route path="/foo">...</Route>
    <Route path="/foo/">...</Route>
  </Router>
);
```

--------------------------------

### Using Bare Location Hooks - JS

Source: https://github.com/molefrog/wouter/blob/v3/README.md

This snippet demonstrates how to use the `useBrowserLocation` hook directly for minimal bundle size. This hook only provides the current location, and route matching must be handled manually.

```js
import { useBrowserLocation } from "wouter/use-browser-location";

const UsersRoute = () => {
  const [location] = useBrowserLocation();

  if (location !== "/users") return null;

  // render the route
};
```

--------------------------------

### Link Component with asChild Prop

Source: https://github.com/molefrog/wouter/blob/v3/README.md

Explains how to use the `asChild` prop with the `Link` component to wrap a custom component that renders an `<a>` element under the hood.  The custom component (`UIKitLink`) must implement an `onClick` handler for navigation to work correctly.

```jsx
// use this instead
<Link to="/" asChild>
  <UIKitLink />
</Link>

// Remember, `UIKitLink` must implement an `onClick` handler
// in order for navigation to work!
```

--------------------------------

### Using ssrSearch prop with Router for SSR in Wouter

Source: https://github.com/molefrog/wouter/blob/v3/README.md

This demonstrates using the `ssrSearch` prop with the `Router` component for server-side rendering (SSR) to properly handle the search query during initial render.  It is necessary for the hook to retrieve the correct search parameters on the server.

```jsx
<Router ssrSearch={request.search}>{/* SSR! */}</Router>
```

--------------------------------

### Testing Routes with memoryLocation - JSX

Source: https://github.com/molefrog/wouter/blob/v3/README.md

This snippet demonstrates how to test wouter routes using the `memoryLocation` hook. This allows for providing a static location to the router for testing specific routes and also recording the navigation history.

```jsx
import { render } from "@testing-library/react";
import { memoryLocation } from "wouter/memory-location";

it("renders a user page", () => {
  // `static` option makes it immutable
  // even if you call `navigate` somewhere in the app location won't change
  const { hook } = memoryLocation({ path: "/user/2", static: true });

  const { container } = render(
    <Router hook={hook}>
      <Route path="/user/:id">{(params) => <>User ID: {params.id}</>}</Route>
    </Router>
  );

  expect(container.innerHTML).toBe("User ID: 2");
});
```

```jsx
it("performs a redirect", () => {
  const { hook, history, navigate } = memoryLocation({
    path: "/",
    // will store navigation history in `history`
    record: true,
  });

  const { container } = render(
    <Router hook={hook}>
      <Switch>
        <Route path="/">Index</Route>
        <Route path="/orders">Orders</Route>

        <Route>
          <Redirect to="/orders" />
        </Route>
      </Switch>
    </Router>
  );

  expect(history).toStrictEqual(["/"]);

  navigate("/unknown/route");

  expect(container.innerHTML).toBe("Orders");
  expect(history).toStrictEqual(["/", "/unknown/route", "/orders"]);
});
```

--------------------------------

### Default Route with Wildcard Parameter

Source: https://github.com/molefrog/wouter/blob/v3/README.md

Demonstrates how to use wildcard parameters in a default route to access the unmatched segment of the path. This can be useful for displaying a 404 message with the requested URL.

```javascript
<Switch>
  <Route path="/users">...</Route>

  {/* will match anything that starts with /users/, e.g. /users/foo, /users/1/edit etc. */}
  <Route path="/users/*">...</Route>

  {/* will match everything else */}
  <Route path="*">
    {(params) => `404, Sorry the page ${params["*"]} does not exist!`}
  </Route>
</Switch>
```

--------------------------------

### Default Route with Switch Component

Source: https://github.com/molefrog/wouter/blob/v3/README.md

Shows how to create a default route that is rendered when no other route in a `Switch` component matches. The default route should always come last within the `Switch`.

```javascript
import { Switch, Route } from "wouter";

<Switch>
  <Route path="/about">...</Route>
  <Route>404, Not Found!</Route>
</Switch>;
```

--------------------------------

### Animating Routes with Framer Motion - JSX

Source: https://github.com/molefrog/wouter/blob/v3/README.md

This snippet illustrates how to animate route transitions using `framer-motion`. It uses `useRoute` to manually match the current route and conditionally render a `motion.div` with animation properties within `AnimatePresence` to ensure proper exit animations.

```jsx
import { motion, AnimatePresence } from "framer-motion";

export const MyComponent = () => (
  <AnimatePresence>
    {/* This will not work! `motion.div` is not a direct child */}
    <Route path="/">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      />
    </Route>
  </AnimatePresence>
);
```

```jsx
export const MyComponent = ({ isVisible }) => {
  const [isMatch] = useRoute("/");

  return (
    <AnimatePresence>
      {isMatch && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        />
      )}
    </AnimatePresence>
  );
};
```

--------------------------------

### Redirect with useLocation Hook

Source: https://github.com/molefrog/wouter/blob/v3/README.md

Shows how to use the `useLocation` hook to trigger a redirect inside an event handler or asynchronous operation. It allows for more advanced logic compared to the basic `Redirect` component.

```javascript
import { useLocation } from "wouter";

const [location, setLocation] = useLocation();

fetchOrders().then((orders) => {
  setOrders(orders);
  setLocation("/app/orders");
});
```

--------------------------------

### Custom Link Component with useRoute - JS

Source: https://github.com/molefrog/wouter/blob/v3/README.md

This snippet shows how to create a custom `<Link>` component that uses the `useRoute` hook to determine if the link is active. It allows for more control over props like `aria-current` or `style` based on the active state.

```js
const [isActive] = useRoute(props.href);

return (
  <Link {...props} asChild>
    <a style={isActive ? { color: "red" } : {}}>{props.children}</a>
  </Link>
);
```

--------------------------------

### Customizing Location Hook with Router Component

Source: https://github.com/molefrog/wouter/blob/v3/README.md

This snippet demonstrates how to customize the location hook used by Wouter by wrapping the application in a `Router` component and providing a custom hook like `useHashLocation`.  This allows for different routing strategies.

```javascript
import { Router, Route } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";

const App = () => (
  <Router hook={useHashLocation}>
    <Route path="/about" component={About} />
    ...
  </Router>
);
```

--------------------------------

### Applying Active Class to Link - JSX

Source: https://github.com/molefrog/wouter/blob/v3/README.md

This snippet demonstrates how to dynamically apply a CSS class to a `<Link>` component based on whether the link's target matches the current route. The `className` prop accepts a function that receives a boolean `active` parameter indicating the match status. An exact match is performed.

```jsx
<Link className={(active) => (active ? "active" : "")}>Nav link</Link>
```

--------------------------------

### Using useParams with Regex Paths in Wouter

Source: https://github.com/molefrog/wouter/blob/v3/README.md

This snippet shows how to use the `useParams` hook with regular expression paths.  It demonstrates accessing capture groups by their index or by their named capture group (if defined).

```javascript
import { Route, useParams } from "wouter";

const User = () => {
  const params = useParams();

  params.id; // "1"
  params[0]; // "1"
};

<Route path={/^[/]user[/](?<id>[0-9]+)[/]?$/} component={User}> </Route>
```

--------------------------------

### Nested Routes with 'nest' prop - JS

Source: https://github.com/molefrog/wouter/blob/v3/README.md

This snippet shows how to create nested routes using the `nest` prop on a `<Route>` component.  Routes defined within a nested route will be scoped relative to the parent route's path.

```js
const App = () => (
  <Router base="/app">
    <Route path="/dashboard" nest>
      {/* the href is "/app/dashboard/users" */}
      <Link to="/users" />

      <Route path="/users">
        {/* Here `useLocation()` returns "/users"! */}
      </Route>
    </Route>
  </Router>
);
```

--------------------------------

### Link Component with Dynamic ClassName

Source: https://github.com/molefrog/wouter/blob/v3/README.md

Shows how to use a function as the `className` prop of the `Link` component to dynamically style active links. The function receives a boolean value indicating whether the link is active for the current route.

```jsx
<Link className={(active) => (active ? "active" : "")}>Nav</Link>
```

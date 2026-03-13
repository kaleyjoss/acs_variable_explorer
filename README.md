# [Variable Explorer for the American Community Survey](acs-variable-explorer.vercel.app)

Webapp ACS variable explorer which can also render an API call for selected variables using tidycensus in R. 

In order to generate the variable names from the ACS label + 'detail', I copied all the variables for 1 year ACS variables into a csv. Then I generated label_varname and detail_varname, using scripting to modify the ACS labels (can be found and modified within creating_variable_namecases.ipynb). Those two labels are then combined to create the variable both_varname: {label_varname}__{detail_varname}. 

Currently the R scripting code assigns both_varname to the variable to retain all identifying information about variables query'd from across different tables.

The variable parsing and csv is available in /public. The UI for this webpage was written by Claude, developed in implementation steps demonstrated the commits of this repository.  

## Data Dictionary and Sources
- Explanation of each variable: [2024 ACS Variable Descriptions](/public/2024_ACSSubjectDefinitions.pdf) 

- ACS Detailed historical codelists and error estimations [here](https://www.census.gov/programs-surveys/acs/technical-documentation/code-lists.html).

- Searchable list of all items within ACS and their Unique IDs [here](public/ACS2024_Table_Shell2s.xlsx)

- Summary tables of which table/topics are within 1year and 5year ACS and which geographic populations are covered by different tables [here](public/2024_DataProductList.xlsx)

## Future plans
- Add ability to filter by 'universe' of population and then select variables you want (ie whole population, specific race, just women, etc)
- Add information about each variable when you click on it-- 
    - Variable definitions and history from [Subject Definitions](/public/2024_ACSSubjectDefinitions.pdf)
    - Allocation (imputation) rate over time
    - Margin of error over time
    - If it's in 5y, 1y or both
- Add wide format option (will have to work around issues with too-long variable names...)
- Add 5year variables
- Add STATA, python, direct-API script rendering options

***UI written with Claude code***

## Deployment Information

### React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

### React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

### Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

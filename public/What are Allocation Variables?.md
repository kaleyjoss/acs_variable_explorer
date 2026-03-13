# What are “Allocation” Variables in ACS?
In the American Community Survey (ACS) and other Census Bureau data, "allocation" is the statistical term for data imputation. Simply put, these tables tell you how often the Census Bureau had to "fill in the blanks" for a specific question because the respondent didn't provide a valid answer.
The tables starting with "B99" are explicitly designed to show you the data quality for various survey topics.
Here is a breakdown of what allocation means, why it happens, and how you should use these tables.

## Why Does Allocation Happen?
When people fill out the ACS, they don't always do it perfectly. The Census Bureau has to allocate (impute) a value when:
- Item Non-response: A person skips a question entirely (e.g., they leave their income blank because they consider it private).
- Invalid Responses: The answer provided makes no sense for the field (e.g., writing "blue" for their age).
- Inconsistent Responses: The answer contradicts other information provided on the same form. For example, if a respondent says they are 6 years old but also claims to have a Ph.D. and an income of $80,000, the Census Bureau will flag this as impossible and allocate a more probable age or education/income level based on the rest of the household.

## How Does the Census Bureau "Allocate" Data?
When data is missing or invalid, the Census Bureau doesn't just guess randomly. They use established statistical methods to fill in the gap:
1.	Relational Imputation: Looking at other answers from the same person or household to deduce the missing fact.
2.	Hot Deck Imputation: Finding another person or household in the same geographic area with very similar demographic characteristics (age, race, education, etc.) who did answer the question, and assigning their answer to the person who left it blank.
## Why the B99 Allocation Tables Matter
The B99 tables (like the ones you listed) give you the allocation rate—usually expressed as the percentage of the total population or households where that specific variable had to be imputed.
- If the allocation rate is low (e.g., 2%): The data for that variable in that specific geographic area is very reliable. Almost everyone actually answered the question.
- If the allocation rate is high (e.g., 25% or more): You should treat the primary data with caution. A high allocation rate means a significant portion of the data you are looking at in the main tables (like the B19 income tables) is actually estimated by the Census Bureau, rather than reported directly by the people living there.
Looking at your examples:
- Allocation of Travel Time to Work: This tells you what percentage of workers had their commute time statistically filled in because they didn't report it themselves.
- Allocation of Individuals' Income: This tells you what percentage of people over 15 had their income statistically imputed. Income questions traditionally have some of the highest allocation rates because people are often hesitant to share financial details.

